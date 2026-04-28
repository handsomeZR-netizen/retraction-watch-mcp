"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { GithubLogo, GoogleLogo, SignIn } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    void fetch("/api/auth/oauth/providers")
      .then((r) => r.json())
      .then((j: { providers: string[] }) => setProviders(j.providers ?? []));
    const e = params.get("error");
    if (e) setError(`OAuth 失败：${e}`);
  }, [params]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "登录失败");
        setBusy(false);
        return;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("rw:auth-changed"));
      }
      router.push(redirect);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">登录</CardTitle>
        <CardDescription>
          使用你的账号继续。还没有账户？
          <Link href="/register" className="ml-1 text-foreground underline">
            注册
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "登录中..." : (
              <>
                <SignIn className="h-4 w-4" weight="bold" />
                登录
              </>
            )}
          </Button>
          <div className="text-center text-xs">
            <Link href="/forgot" className="text-muted-foreground hover:text-foreground underline">
              忘记密码？
            </Link>
          </div>
        </form>

        {providers.length > 0 && (
          <>
            <div className="relative my-6">
              <Separator />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="bg-card px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  或使用第三方
                </span>
              </span>
            </div>
            <div className="space-y-2">
              {providers.includes("github") && (
                <Button asChild variant="outline" className="w-full">
                  <a href={`/api/auth/oauth/github?redirect=${encodeURIComponent(redirect)}`}>
                    <GithubLogo className="h-4 w-4" weight="duotone" />
                    GitHub 登录
                  </a>
                </Button>
              )}
              {providers.includes("google") && (
                <Button asChild variant="outline" className="w-full">
                  <a href={`/api/auth/oauth/google?redirect=${encodeURIComponent(redirect)}`}>
                    <GoogleLogo className="h-4 w-4" weight="duotone" />
                    Google 登录
                  </a>
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
