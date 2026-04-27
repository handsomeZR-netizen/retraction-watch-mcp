"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle, UsersThree, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface InviteInfo {
  workspaceId: string;
  workspaceName: string | null;
  role: string;
  expired: boolean;
  used: boolean;
  error?: string;
}

export default function InvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`/api/workspaces/invite/${params.token}`)
      .then(async (r) => {
        const j = await r.json();
        setInfo(r.ok ? (j as InviteInfo) : { ...(j as InviteInfo), error: j.error });
      })
      .catch((e) =>
        setInfo({
          workspaceId: "",
          workspaceName: null,
          role: "",
          expired: false,
          used: false,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    void fetch("/api/auth/me").then(async (r) => {
      const j = (await r.json()) as { user: unknown | null };
      setAuthed(Boolean(j.user));
    });
  }, [params.token]);

  if (!info) return <div className="text-sm text-muted-foreground">Loading…</div>;

  if (info.error || info.used || info.expired) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="flex items-center justify-center gap-2">
              <Warning className="h-5 w-5 text-destructive" weight="duotone" />
              邀请不可用
            </CardTitle>
            <CardDescription>
              {info.used ? "该邀请已被使用" : info.expired ? "该邀请已过期" : info.error}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/">返回首页</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function accept() {
    setBusy(true);
    const res = await fetch(`/api/workspaces/invite/${params.token}`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error ?? "接受失败");
      return;
    }
    const j = (await res.json()) as { workspaceId: string };
    toast.success("已加入");
    await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: j.workspaceId }),
    });
    router.push(`/workspaces/${j.workspaceId}`);
    router.refresh();
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            <UsersThree className="h-5 w-5" weight="duotone" />
            加入团队空间
          </CardTitle>
          <CardDescription>
            你被邀请加入「{info.workspaceName ?? "（未命名）"}」（角色：{info.role}）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {authed === false ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">需要先登录或注册才能接受邀请。</p>
              <div className="flex gap-2 justify-center">
                <Button asChild variant="outline">
                  <Link href={`/login?redirect=/invite/${params.token}`}>登录</Link>
                </Button>
                <Button asChild>
                  <Link href={`/register?redirect=/invite/${params.token}`}>注册</Link>
                </Button>
              </div>
            </div>
          ) : authed === true ? (
            <Button onClick={accept} disabled={busy}>
              <CheckCircle className="h-4 w-4" weight="bold" />
              {busy ? "加入中..." : "接受邀请"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">检查登录状态…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
