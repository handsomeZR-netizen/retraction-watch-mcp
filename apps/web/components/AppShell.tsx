"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { SessionsProvider } from "@/components/sessions/SessionsContext";

const PUBLIC_PATHS = new Set(["/login", "/register", "/forgot"]);
const PUBLIC_PREFIXES = ["/reset/", "/verify/", "/invite/", "/share/"];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { user: unknown | null }) => {
        if (!cancelled) setAuthed(Boolean(j.user));
      })
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });
    function onAuthChanged() {
      void fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { user: unknown | null }) => setAuthed(Boolean(j.user)))
        .catch(() => setAuthed(false));
    }
    window.addEventListener("rw:auth-changed", onAuthChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("rw:auth-changed", onAuthChanged);
    };
  }, [pathname]);

  // Public routes: minimal layout (no sidebar, no header). The /share/[token]
  // pages need full width to render the result; auth pages stay in a centered
  // narrow column.
  if (isPublicRoute(pathname)) {
    if (pathname.startsWith("/share/")) {
      return (
        <div className="min-h-screen px-4 py-8 max-w-5xl mx-auto">{children}</div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    );
  }

  // Private route: always mount SessionsProvider so children that call
  // useSessions() never throw, regardless of auth-check state.
  return (
    <SessionsProvider>
      <PrivateLayout authed={authed}>{children}</PrivateLayout>
    </SessionsProvider>
  );
}

function PrivateLayout({
  authed,
  children,
}: {
  authed: boolean | null;
  children: React.ReactNode;
}) {
  // While auth check is in flight, render a minimal frame.
  if (authed === null) {
    return (
      <div className="relative flex min-h-screen flex-col">
        <Header />
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10">{children}</main>
      </div>
    );
  }
  // Unauthenticated on a private route: middleware already redirected to /login;
  // this is just a fallback while the redirect propagates.
  if (!authed) {
    return <>{children}</>;
  }
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header sidebarMode />
        <main className="flex-1 w-full mx-auto px-6 py-8 max-w-5xl">{children}</main>
        <footer className="border-t border-border/40">
          <div className="max-w-5xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground">
            <span>© RW Screen · 仅辅助筛查，不作为学术不端裁定的终审依据</span>
            <span className="font-mono">v0.2.0-dev</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
