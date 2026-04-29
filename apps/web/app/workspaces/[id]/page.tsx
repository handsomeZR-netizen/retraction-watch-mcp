"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Crown,
  Plus,
  ShieldCheck,
  TrashSimple,
  UsersThree,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { avatarUrl } from "@/lib/avatar";

interface WSDetail {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
  role: "owner" | "admin" | "member";
}

interface Member {
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
}

interface Invite {
  token: string;
  workspace_id: string;
  invited_by: string;
  role: string;
  created_at: string;
  expires_at: string | null;
  used_by: string | null;
  used_at: string | null;
}

export default function WorkspaceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<{ workspace: WSDetail; members: Member[] } | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setData(null);
    setInvites([]);
    try {
      const res = await fetch(`/api/workspaces/${id}`, { signal });
      if (signal?.aborted) return;
      if (!res.ok) {
        toast.error("加载失败");
        router.push("/workspaces");
        return;
      }
      const j = (await res.json()) as { workspace: WSDetail; members: Member[] };
      if (signal?.aborted) return;
      setData(j);
      setName(j.workspace.name);
      if (j.workspace.role === "owner" || j.workspace.role === "admin") {
        const inv = await fetch(`/api/workspaces/${id}/invites`, { signal });
        if (signal?.aborted) return;
        if (inv.ok) setInvites(((await inv.json()) as { invites: Invite[] }).invites);
      }
    } catch {
      if (signal?.aborted) return;
      toast.error("加载失败");
      router.push("/workspaces");
    }
  }, [id, router]);

  useEffect(() => {
    const controller = new AbortController();
    setOrigin(window.location.origin);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!data) return <Skeleton className="h-64 w-full" />;
  const ws = data.workspace;
  const isManager = ws.role === "owner" || ws.role === "admin";

  async function rename() {
    if (name === ws.name) return;
    const res = await fetch(`/api/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) toast.error("重命名失败");
    else {
      toast.success("已重命名");
      void load();
    }
  }

  async function newInvite() {
    const res = await fetch(`/api/workspaces/${id}/invites`, { method: "POST" });
    if (!res.ok) {
      toast.error("生成失败");
      return;
    }
    const j = (await res.json()) as { invite: Invite };
    setInvites([j.invite, ...invites]);
    toast.success("邀请链接已生成");
  }

  async function removeMember(userId: string) {
    if (!confirm("移除该成员？")) return;
    const res = await fetch(`/api/workspaces/${id}/members/${userId}`, {
      method: "DELETE",
    });
    if (!res.ok) toast.error("操作失败");
    else void load();
  }

  async function deleteWS() {
    if (!confirm(`确认删除空间「${ws.name}」？该操作会删除所有团队稿件。`)) return;
    const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    if (!res.ok) toast.error("删除失败");
    else router.push("/workspaces");
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <Link
        href="/workspaces"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" weight="bold" />
        返回空间列表
      </Link>

      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <UsersThree className="h-7 w-7" weight="duotone" />
          {ws.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{ws.slug}</span> · 创建于{" "}
          {new Date(ws.created_at).toLocaleDateString()} · 你的角色：{ws.role}
        </p>
      </header>

      {isManager && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基础设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">名称</Label>
              <div className="flex gap-2">
                <Input
                  id="ws-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={64}
                />
                <Button onClick={rename} disabled={name === ws.name}>保存</Button>
              </div>
            </div>
            {ws.role === "owner" && (
              <div className="pt-3 border-t">
                <Button variant="outline" onClick={deleteWS} className="text-destructive">
                  <TrashSimple className="h-4 w-4" weight="duotone" />
                  删除空间
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">成员（{data.members.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {data.members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarUrl(m.avatar_seed ?? m.username, { size: 48 })}
                  alt=""
                  width={32}
                  height={32}
                  className="rounded-full bg-muted shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-sm">
                    {m.display_name ?? m.username}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {m.username} · 加入于{" "}
                    {new Date(m.joined_at).toLocaleDateString()}
                  </div>
                </div>
                {m.role === "owner" ? (
                  <Badge variant="success">
                    <Crown className="h-2.5 w-2.5" weight="fill" /> owner
                  </Badge>
                ) : m.role === "admin" ? (
                  <Badge variant="secondary">
                    <ShieldCheck className="h-2.5 w-2.5" weight="fill" /> admin
                  </Badge>
                ) : (
                  <Badge variant="muted">member</Badge>
                )}
                {isManager && m.user_id !== ws.owner_id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMember(m.user_id)}
                    className="text-destructive"
                  >
                    <TrashSimple className="h-4 w-4" weight="duotone" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isManager && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">邀请链接</CardTitle>
            <Button onClick={newInvite}>
              <Plus className="h-4 w-4" weight="bold" />
              生成新邀请
            </Button>
          </CardHeader>
          <CardContent>
            {invites.length === 0 && (
              <p className="text-sm text-muted-foreground">还没有邀请链接</p>
            )}
            <ul className="space-y-2">
              {invites.map((inv) => {
                const expired =
                  inv.expires_at && Date.parse(inv.expires_at) < Date.now();
                const link = `${origin}/invite/${inv.token}`;
                return (
                  <li
                    key={inv.token}
                    className="flex items-center gap-2 rounded-md border p-3 text-xs"
                  >
                    <code className="flex-1 truncate font-mono text-muted-foreground">
                      {link}
                    </code>
                    {inv.used_at ? (
                      <Badge variant="muted">已使用</Badge>
                    ) : expired ? (
                      <Badge variant="destructive">已过期</Badge>
                    ) : (
                      <Badge variant="success">可用</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        void navigator.clipboard.writeText(link);
                        toast.success("已复制");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" weight="duotone" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
