/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

export default nextConfig;
