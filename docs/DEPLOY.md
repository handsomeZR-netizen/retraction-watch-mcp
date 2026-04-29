# Single-VPS deployment guide

This is the operational checklist for running rw-screen on one machine
(Linux VPS or bare metal). Multi-instance horizontal scaling is **not
supported in this release** — see "Known limitations" below.

For Cloudflare Tunnel exposure (no public IP needed), see also
[`DEPLOY-CLOUDFLARE.md`](./DEPLOY-CLOUDFLARE.md).

---

## 1. One-time setup

### 1.1 Provision

```bash
# Recommended: Ubuntu 22.04 / Debian 12, 2 vCPU, 4 GB RAM, 40 GB SSD.
sudo apt-get update && sudo apt-get install -y nodejs npm git build-essential
node --version   # must be >= 20
```

### 1.2 Clone + install

```bash
git clone https://github.com/handsomeZR-netizen/retraction-watch-mcp.git /opt/rw-screen
cd /opt/rw-screen
npm ci
npm run build              # builds @rw/core and @rw/ingest
npm run build -w @rw/web   # produces apps/web/.next/standalone
```

### 1.3 Import the Retraction Watch corpus

```bash
# Pulls the latest CSV and writes ./data/retraction-watch.sqlite (~70k rows).
npm run import
```

You can re-run this on a cron (weekly) to refresh; the app reads the SQLite
file lazily, no restart needed.

### 1.4 Generate secrets

```bash
mkdir -p /etc/rw-screen
# 64-byte urandom for session sealing:
openssl rand -hex 32 > /etc/rw-screen/session.key
# 64-char hex for AES-256-GCM data key (LLM-key-at-rest, IP hash salt):
openssl rand -hex 32 > /etc/rw-screen/data.key
chmod 600 /etc/rw-screen/*.key
chown -R rwscreen:rwscreen /etc/rw-screen
```

### 1.5 Seed the first admin

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='changeme-now' \
  npm run -w @rw/web seed-admin
```

Log in once and change the password from `/account`.

---

## 2. Environment variables

| Variable | Required? | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | `development` | Set to `production` |
| `RW_BASE_URL` | **yes (prod)** | — | `https://rw.example.com`; CSRF middleware uses this as the canonical origin |
| `RW_SESSION_SECRET` *or* `RW_SESSION_SECRET_FILE` | yes | — | iron-session sealing key; `_FILE` reads docker/k8s secrets |
| `RW_DATA_KEY` *or* `RW_DATA_KEY_FILE` | yes | — | 64-hex AES-256 key for at-rest LLM keys + audit IP hash salt |
| `RW_TRUST_PROXY` | no | `0` | Set to `1` only when behind a proxy you control; otherwise X-Forwarded-* are ignored |
| `RW_APP_DB_DIR` | no | `~/.config/rw-screen` | App SQLite + uploads location |
| `RW_SCREEN_CONFIG_DIR` | no | same as above | `config.json` location |
| `RW_SCREEN_DATA_DIR` | no | `<RW_APP_DB_DIR>/manuscripts` | Per-manuscript dirs |
| `RW_MCP_DB_PATH` | no | `~/.retraction-watch-mcp/retraction-watch.sqlite` | RW corpus DB |
| `RW_BACKUP_DIR` | no | `<RW_APP_DB_DIR>/backups` | Where backup-sqlite.mjs writes |
| `RW_BACKUP_KEEP` | no | `30` | Backup rotation count |
| `RW_HSTS_INCLUDE_SUBDOMAINS` | no | unset | Set `1` to add `includeSubDomains` to HSTS |
| `RW_HSTS_PRELOAD` | no | unset | Set `1` only after enrolling at hstspreload.org |
| `SMTP_URL` *or* `SMTP_HOST/PORT/USER/PASS` | optional | — | Without these, email goes to console (dev only) |
| `SMTP_FROM` | no | `RW Screen <noreply@example.com>` | Mail From header |
| `OAUTH_GITHUB_CLIENT_ID/SECRET` | optional | — | GitHub OAuth login |
| `OAUTH_GOOGLE_CLIENT_ID/SECRET` | optional | — | Google OAuth login |

---

## 3. Run as a systemd service

`/etc/systemd/system/rw-screen.service`:

```ini
[Unit]
Description=RW Screen
After=network-online.target

[Service]
Type=simple
User=rwscreen
WorkingDirectory=/opt/rw-screen
EnvironmentFile=/etc/rw-screen/env
ExecStart=/usr/bin/node apps/web/.next/standalone/apps/web/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

`/etc/rw-screen/env`:

```
NODE_ENV=production
RW_BASE_URL=https://rw.example.com
RW_SESSION_SECRET_FILE=/etc/rw-screen/session.key
RW_DATA_KEY_FILE=/etc/rw-screen/data.key
RW_APP_DB_DIR=/var/lib/rw-screen/db
RW_SCREEN_DATA_DIR=/var/lib/rw-screen/manuscripts
RW_MCP_DB_PATH=/var/lib/rw-screen/retraction-watch.sqlite
RW_BACKUP_DIR=/var/lib/rw-screen/backups
RW_TRUST_PROXY=1
PORT=3210
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rw-screen
journalctl -u rw-screen -f       # live logs
```

The instrumentation hook validates the data dirs, opens the SQLite DBs, and
resets any `parsing` manuscripts left over from the previous process (the
in-memory queue does not survive restart).

---

## 4. Reverse proxy (nginx + Let's Encrypt)

```nginx
server {
    listen 443 ssl http2;
    server_name rw.example.com;

    ssl_certificate     /etc/letsencrypt/live/rw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rw.example.com/privkey.pem;

    client_max_body_size 60M;          # > 50M app upload cap
    proxy_read_timeout 600s;            # SSE long-poll for parse progress
    proxy_buffering off;                # required for SSE

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name rw.example.com;
    return 301 https://$host$request_uri;
}
```

Set `RW_TRUST_PROXY=1` so the app honors the forwarded headers from nginx.
**Do not** set this without a proxy in front of you — it lets a direct
attacker rotate spoofed IPs and bypass per-IP rate limits.

---

## 5. Backups

```bash
# Hot backup (no app downtime). Run daily via cron / systemd timer.
node /opt/rw-screen/scripts/backup-sqlite.mjs
```

Output: `<RW_BACKUP_DIR>/app-YYYYMMDD-HHmmss-<hex>.sqlite.gz`. Rotation keeps
the newest `RW_BACKUP_KEEP` files (default 30).

Restore:

```bash
sudo systemctl stop rw-screen
gunzip -c /var/lib/rw-screen/backups/app-20260428-031500-abc123.sqlite.gz \
  > /var/lib/rw-screen/db/app.sqlite
sudo systemctl start rw-screen
```

The Retraction Watch corpus DB (`retraction-watch.sqlite`) is read-only and
re-created by `npm run import`; no app-level backup needed.

---

## 6. Upgrades

```bash
cd /opt/rw-screen
git pull
npm ci
npm run build && npm run build -w @rw/web
sudo systemctl restart rw-screen
```

The instrumentation hook applies any pending DB migrations on first boot.
Each migration is wrapped in a transaction so a partial failure rolls back
without advancing `user_version`.

---

## 7. Health + observability

```bash
curl -s https://rw.example.com/api/health
# {"ok":true,"database":{"rowCount":69911,"generatedOn":"2026-04-24",...}}

journalctl -u rw-screen -f -p info       # info+ from the service
journalctl -u rw-screen --since "1h ago" # recent
```

The audit log lives in the app SQLite DB; admins see it under `/admin`.
IPs are stored as 16-char salted SHA-256, not raw addresses. Audit rows are
append-only in the application; archive or prune them externally if your
deployment requires a retention policy.

---

## 8. Known limitations

* **Single-instance only.** rate-limit buckets, the parse queue, and SSE
  progress fan-out are all in-memory module globals. Running ≥2 replicas
  causes the queue to be invisible across processes and rate limits to be
  per-replica. Multi-instance scaling needs Redis (rate-limit + pub/sub)
  and a persistent job queue (bullmq / Postgres) — out of scope for this
  release.
* **PDF reading order.** Two-column PDFs and right-to-left scripts are
  passed to `unpdf` as-is. Bad column reading order silently produces
  garbled metadata; we have no bidi normalization or column reconstruction.
* **OCR.** Only image inputs flow through OCR. Scanned-image PDFs without
  embedded text marker as `text_extraction_empty` and the operator must
  rasterize externally.
* **CJK / Arabic / Hebrew author names.** The author-detection heuristics
  are Latin-script biased. CJK works for Han characters via pinyin
  fallback; other non-Latin scripts are best-effort only.
* **No multi-instance / read replica support.** Better-sqlite3 serializes
  all writes through the single-writer lock.

These are tracked as post-1.0 work; a single VPS deployment is fully
supported and verified end-to-end (`scripts/e2e-fixtures.mjs` + Playwright
suite).
