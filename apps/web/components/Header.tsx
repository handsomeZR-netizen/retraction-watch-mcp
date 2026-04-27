"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GithubLogo } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HealthIndicator } from "@/components/HealthIndicator";
import { UserMenu } from "@/components/UserMenu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "首页" },
  { href: "/history", label: "历史" },
  { href: "/settings", label: "设置" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-background text-[11px] font-bold tracking-wider"
          >
            RW
          </span>
          <span className="text-base font-semibold tracking-tight">
            RW Screen
          </span>
        </Link>

        <nav className="flex items-center gap-5 text-sm font-medium">
          {NAV.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "transition-colors hover:text-foreground",
                pathname === link.href
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <HealthIndicator />
          <Button variant="ghost" size="icon" asChild>
            <a
              href="https://github.com/handsomeZR-netizen/retraction-watch-mcp"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
            >
              <GithubLogo className="h-[1.1rem] w-[1.1rem]" weight="duotone" />
            </a>
          </Button>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
