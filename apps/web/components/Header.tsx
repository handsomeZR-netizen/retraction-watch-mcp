"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Microscope } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { HealthIndicator } from "@/components/HealthIndicator";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "首页" },
  { href: "/history", label: "历史" },
  { href: "/account", label: "账户" },
  { href: "/settings", label: "设置" },
];

export function Header({ sidebarMode = false }: { sidebarMode?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const showBack = pathname !== "/";

  function goBack() {
    // Prefer in-app history when there is one; fall back to home.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div
        className={cn(
          "h-14 flex items-center gap-6",
          sidebarMode ? "px-6" : "max-w-6xl mx-auto px-6",
        )}
      >
        {!sidebarMode && (
          <Link href="/" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-background"
            >
              <Microscope className="h-4 w-4" weight="duotone" />
            </span>
            <span className="text-base font-semibold tracking-tight">
              RW Screen
            </span>
          </Link>
        )}

        {!sidebarMode && (
          <nav className="flex items-center gap-5 text-sm font-medium">
            {NAV.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "transition-colors hover:text-foreground",
                  pathname === link.href ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        {showBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" weight="bold" />
            返回
          </Button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <WorkspaceSwitcher />
          <HealthIndicator />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
