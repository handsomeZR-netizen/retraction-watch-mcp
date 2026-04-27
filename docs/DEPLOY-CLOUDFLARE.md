# 部署到 Cloudflare Tunnel（无需绑卡）

> 这是一份"零成本零绑卡"的部署方案。利用 Cloudflare Tunnel 把本机运行的 RW Screen 服务以 HTTPS 公网地址暴露出去，全程不需要信用卡、不需要服务器、不需要再上传 360MB 的 SQLite 数据库。
>
> **适合什么场景**：演示、小团队内部使用、随用随关。
>
> **不适合什么场景**：你需要 24×7 高可用（你电脑得开着），或者编辑部多用户同时上传大文件。

---

## 一、为什么选这个方案

| 平台 | 信用卡 | 是否支持 360MB SQLite | 月度费用 |
| --- | --- | --- | --- |
| Vercel | 否 | ❌（serverless function 上限 250MB） | 免费 |
| Railway | **是** | ✅ Volume | $5/月起 |
| Fly.io | **是** | ✅ Volume | $2-11/月 |
| Render Free | 否 | ❌（无持久磁盘 + 15分钟休眠） | 免费 |
| **Cloudflare Tunnel + 本机** | **否** | ✅（数据库就在你电脑上） | 免费 |

Cloudflare Tunnel 是 Cloudflare 提供的反向隧道：本机 cloudflared 守护进程主动出连接到 Cloudflare 边缘节点，访问者通过 `*.trycloudflare.com` 或你绑定的域名访问，流量经 Cloudflare 反代到本机。**不需要开端口，不需要公网 IP**。

---

## 二、5 分钟快速演示（一次性 URL，关机即失效）

最快验证效果的方式 —— 一条命令，立刻拿到 `https://*.trycloudflare.com` 的临时地址。

### 1. 装 cloudflared

**Windows**（PowerShell 管理员）：
```powershell
winget install --id Cloudflare.cloudflared
```

**macOS**：
```bash
brew install cloudflared
```

**Linux**：
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
```

### 2. 在仓库根目录起两个进程

终端 A — 启动 Web 服务（已经熟悉的命令）：
```bash
cd D:/desktop/数据库爬取
RW_MCP_DB_PATH="D:/desktop/数据库爬取/data/retraction-watch.sqlite" \
  npm run dev:web
# 等到 "Ready in X.Xs"
```

终端 B — 启动 Cloudflare Tunnel：
```bash
cloudflared tunnel --url http://localhost:3210
```

输出会包含：
```
Your quick Tunnel has been created! Visit it at:
https://random-name-here-1234.trycloudflare.com
```

把这个 URL 发给同事 / 浏览器打开，就能用了。**关闭终端 B 即失效**，URL 不会泄漏数据。

### 3. 访问 + 验证

```bash
curl https://random-name-here-1234.trycloudflare.com/api/health
# {"ok":true,"database":{"rowCount":69911,...}}
```

---

## 三、绑定自有域名（推荐做法，URL 稳定）

临时 URL 每次重启都会变，分享不便。如果你有一个域名（比如 `yourname.com`），花 10 分钟可以绑成 `screen.yourname.com`。**域名转入 Cloudflare DNS 是免费的**。

### 1. 把域名 DNS 切到 Cloudflare

- 在 [dash.cloudflare.com](https://dash.cloudflare.com/) 注册账户（免费）
- "Add a site" → 输入你的域名 → 选 Free 计划
- Cloudflare 会给你两个 nameserver，去你买域名的注册商把 NS 改成这两个
- 等 DNS 切换生效（通常 5-30 分钟）

### 2. 创建命名隧道

```bash
cloudflared tunnel login         # 浏览器跳转，授权 Cloudflare 账户
cloudflared tunnel create rw-screen
# 输出："Tunnel credentials written to /home/you/.cloudflared/<UUID>.json"
```

### 3. 写隧道配置

`~/.cloudflared/config.yml`：

```yaml
tunnel: rw-screen
credentials-file: /home/you/.cloudflared/<UUID>.json

ingress:
  - hostname: screen.yourname.com
    service: http://localhost:3210
  - service: http_status:404
```

### 4. 加 DNS 记录

```bash
cloudflared tunnel route dns rw-screen screen.yourname.com
# 自动在 Cloudflare 上加 CNAME，指向 <UUID>.cfargotunnel.com
```

### 5. 启动

```bash
cloudflared tunnel run rw-screen
# 然后浏览器访问 https://screen.yourname.com
```

### 6. 开机自启（可选）

**Windows 服务**：
```powershell
cloudflared service install
```

**Linux systemd**：
```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

**macOS launchd**：
```bash
sudo cloudflared service install
```

---

## 四、加访问保护（强烈建议）

公网 URL = 任何人都能上传稿件。两种零成本保护方案：

### 方案 A：Cloudflare Access（推荐，最方便）

1. Cloudflare Dashboard → Zero Trust → Access → Applications → Add Application
2. Application type: Self-hosted
3. Application domain: `screen.yourname.com`
4. Add a policy：
   - Action: Allow
   - Include: Emails ending in `@yourcompany.com`，或具体邮箱列表
5. 保存

之后访问 URL 会先跳一个 Cloudflare 登录页，输入授权邮箱后才能进入。**完全免费，免费层支持最多 50 个用户**。

### 方案 B：Basic Auth（最简单）

在隧道前加一层 Cloudflare Worker 做 HTTP Basic Auth，或者直接让 Next.js 自己加 middleware。最快是后者：

`apps/web/middleware.ts`（新建）：

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const USER = process.env.RW_BASIC_USER ?? "";
const PASS = process.env.RW_BASIC_PASS ?? "";

export function middleware(req: NextRequest) {
  if (!USER || !PASS) return NextResponse.next();
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Basic ")) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="RW Screen"' },
    });
  }
  const [u, p] = atob(auth.slice(6)).split(":");
  if (u !== USER || p !== PASS) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

然后启动时设环境变量：
```bash
RW_BASIC_USER=alice RW_BASIC_PASS=mypass npm run dev:web
```

---

## 五、性能与限制

- **上传大小**：Cloudflare 免费层单次请求 **100MB** 上限。本服务 50MB 限制在内，没问题。
- **SSE**：Cloudflare 默认会 buffer 响应，但对 `text/event-stream` 自动透传，无需额外配置。
- **SQLite**：数据库就在你电脑上，零延迟。
- **可用性**：本机关机 = 服务下线。如果需要 24×7 必须租 VPS（参考 README 里的 Docker 部署章节）。

---

## 六、和 Docker 部署组合（升级版：放到 NAS / 旧笔记本上）

如果你有一台不关机的设备（NAS、Mac mini、旧 ThinkPad），可以：

```bash
# 在 NAS 上跑容器
docker compose up -d

# 同一台设备装 cloudflared
cloudflared tunnel --url http://localhost:3210
```

这就变成了"零成本 24×7 公网服务"。

---

## 故障排查

**Q: cloudflared 报 "connection reset"**
A: 检查本机服务真的在 3210 监听：`curl http://localhost:3210/api/health`。

**Q: 浏览器打开慢、白屏**
A: Cloudflare 默认开了 `Auto Minify`，对 Next.js 已经压缩过的产物会做无效优化。Cloudflare Dashboard → Speed → Optimization → Auto Minify → 全关。

**Q: SSE 断流**
A: Cloudflare 对长连接默认 100s 超时（免费层）。本服务单稿件解析 < 30s 不受影响。如果你做超长批量任务，把任务异步化（已经是 SSE 推进度了，不会被打断）。

**Q: 上传大文件 413**
A: 免费层硬限制 100MB。要更大，付费方案见 [Cloudflare 限额](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)。

---

完成后回到 README，那里也有 Docker 自托管的对应章节，二选一即可。
