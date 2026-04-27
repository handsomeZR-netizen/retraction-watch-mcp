import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

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
    <html lang="zh-CN">
      <body>
        <header className="border-b border-white/10">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link href="/" className="text-lg font-semibold">
              RW Screen
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-300">
              <Link href="/" className="hover:text-white">
                首页
              </Link>
              <Link href="/settings" className="hover:text-white">
                设置
              </Link>
              <a
                href="https://retractionwatch.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white"
              >
                Retraction Watch
              </a>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        <footer className="border-t border-white/10 mt-12">
          <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-slate-400">
            本系统仅辅助筛查，不作为学术不端裁定的终审依据。结果应由编辑或评审人员人工复核。
          </div>
        </footer>
      </body>
    </html>
  );
}
