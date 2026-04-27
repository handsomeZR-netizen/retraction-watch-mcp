import type { Metadata } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";
import { StatusDot } from "@/components/StatusDot";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-noto-sc",
});

export const metadata: Metadata = {
  title: "RW Screen — 学术诚信筛查",
  description:
    "拖拽上传 PDF / Word / LaTeX 稿件，自动比对参考文献是否引用 Retraction Watch 撤稿数据库。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${notoSansSC.variable}`}>
      <body>
        <header className="sticky top-0 z-30 backdrop-blur-md bg-[var(--bg-0)]/70 border-b border-white/5">
          <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
            <Link
              href="/"
              className="flex items-center gap-2.5 group"
              aria-label="RW Screen home"
            >
              <span
                aria-hidden
                className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-500 shadow-lg shadow-blue-500/20 text-white font-semibold text-sm"
              >
                RW
              </span>
              <span className="text-base font-semibold tracking-tight">
                RW Screen
              </span>
              <span className="text-[10px] uppercase tracking-wider text-slate-500 hidden sm:inline">
                学术诚信筛查
              </span>
            </Link>
            <nav className="flex items-center gap-5">
              <NavLinks />
              <span className="hidden md:flex pl-3 border-l border-white/10">
                <StatusDot />
              </span>
            </nav>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-10">{children}</main>

        <footer className="mt-16 border-t border-white/5">
          <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-xs text-slate-500">
            <span>
              © RW Screen · 本系统仅辅助筛查，不作为学术不端裁定的终审依据
            </span>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/handsomeZR-netizen/retraction-watch-mcp"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-300"
              >
                GitHub
              </a>
              <span className="text-slate-700">·</span>
              <span>v0.2.0-dev</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
