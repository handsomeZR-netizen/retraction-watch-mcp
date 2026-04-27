import type { Metadata } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";
import { StatusDot } from "@/components/StatusDot";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";

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
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${inter.variable} ${notoSansSC.variable}`}
    >
      <body className="font-sans antialiased">
        <ThemeProvider>
          <header className="sticky top-0 z-30 backdrop-blur-md bg-background/80 border-b border-border">
            <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
              <Link
                href="/"
                className="flex items-center gap-2.5 group"
                aria-label="RW Screen home"
              >
                <span
                  aria-hidden
                  className="w-7 h-7 rounded-md flex items-center justify-center bg-primary text-primary-foreground font-semibold text-[11px] tracking-wider"
                >
                  RW
                </span>
                <span className="text-base font-semibold tracking-tight text-foreground">
                  RW Screen
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground hidden sm:inline">
                  学术诚信筛查
                </span>
              </Link>
              <nav className="flex items-center gap-5">
                <NavLinks />
                <span className="hidden md:flex pl-3 border-l border-border">
                  <StatusDot />
                </span>
                <ThemeToggle />
              </nav>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-6 py-10">{children}</main>

          <footer className="mt-16 border-t border-border">
            <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-xs text-muted-foreground">
              <span>
                © RW Screen · 本系统仅辅助筛查，不作为学术不端裁定的终审依据
              </span>
              <div className="flex items-center gap-3">
                <a
                  href="https://github.com/handsomeZR-netizen/retraction-watch-mcp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  GitHub
                </a>
                <span>·</span>
                <span>v0.2.0-dev</span>
              </div>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
