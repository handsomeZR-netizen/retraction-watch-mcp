import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const buildRuntimeTraceExcludes = [
  ".next/build-runtime/**/*",
  `${path.join(os.homedir(), ".config", "rw-screen").replaceAll("\\", "/")}/**/*`,
  "**/C:/Users/**/.config/rw-screen/**/*",
];

function applyBuildRuntimeEnv(phase) {
  if (phase !== PHASE_PRODUCTION_BUILD) return;

  const runtimeRoot = path.join(appDir, ".next", "build-runtime");
  process.env.RW_APP_DB_DIR ??= path.join(runtimeRoot, "db");
  process.env.RW_SCREEN_CONFIG_DIR ??= path.join(runtimeRoot, "config");
  process.env.RW_SCREEN_DATA_DIR ??= path.join(runtimeRoot, "manuscripts");
}

/** @type {import('next').NextConfig} */
function createNextConfig(phase) {
  applyBuildRuntimeEnv(phase);

  const isProd = process.env.NODE_ENV === "production";

  // CSP: keep 'unsafe-inline'/'unsafe-eval' for now — Next 15 with RSC + dev
  // tooling still requires them; nonce-based CSP is a separate refactor.
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  const securityHeaders = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
    { key: "Content-Security-Policy", value: csp },
  ];
  if (isProd) {
    // HSTS: max-age only by default. `includeSubDomains` and `preload` are
    // deployment commitments (preload requires actual enrollment in the
    // browser preload list, includeSubDomains breaks any non-HTTPS subdomain).
    // Opt in explicitly via env when the operator is ready for either.
    const hstsParts = ["max-age=63072000"];
    if (process.env.RW_HSTS_INCLUDE_SUBDOMAINS === "1") hstsParts.push("includeSubDomains");
    if (process.env.RW_HSTS_PRELOAD === "1") hstsParts.push("preload");
    securityHeaders.push({
      key: "Strict-Transport-Security",
      value: hstsParts.join("; "),
    });
  }

  return {
    output: "standalone",
    serverExternalPackages: [
      "better-sqlite3",
      "@rw/core",
      "@rw/ingest",
      "pdfjs-dist",
      "unpdf",
      "tesseract.js",
      "mammoth",
      "yauzl",
    ],
    outputFileTracingIncludes: {
      "/api/**": ["./node_modules/better-sqlite3/**"],
    },
    outputFileTracingExcludes: {
      "/*": buildRuntimeTraceExcludes,
      "/api/**": buildRuntimeTraceExcludes,
    },
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  };
}

export default createNextConfig;
