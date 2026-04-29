"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ShieldStar, SignOut, User } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { avatarUrl } from "@/lib/avatar";

interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "user" | "admin";
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  avatarSeed: string;
  manuscripts: number;
}

const PAGE_SIZE = 20;

export function AdminUsersTable() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (activeQuery) params.set("q", activeQuery);
    void fetch(`/api/admin/users?${params.toString()}`).then(async (res) => {
      if (!res.ok) {
        toast.error("加载失败");
        return;
      }
      const j = (await res.json()) as {
        users: AdminUser[];
        total: number;
      };
      setUsers(j.users);
      setTotal(j.total);
    });
  }, [activeQuery, offset]);

  async function patchUser(u: AdminUser, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? "操作失败");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setActiveQuery(query.trim());
  }

  async function toggleDisable(u: AdminUser, disabled: boolean) {
    try {
      await patchUser(u, { disabled });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
      return;
    }
    toast.success(disabled ? "已禁用" : "已启用");
    setUsers((prev) =>
      prev?.map((row) => (row.id === u.id ? { ...row, disabled } : row)) ?? prev,
    );
  }

  async function changeRole(u: AdminUser) {
    const role = u.role === "admin" ? "user" : "admin";
    try {
      await patchUser(u, { role });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
      return;
    }
    toast.success(role === "admin" ? "已设为管理员" : "已改为普通用户");
    setUsers((prev) =>
      prev?.map((row) => (row.id === u.id ? { ...row, role } : row)) ?? prev,
    );
  }

  async function forceLogout(u: AdminUser) {
    try {
      await patchUser(u, { forceLogout: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
      return;
    }
    toast.success("已注销该用户的现有会话");
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <Card>
      <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="font-serif flex items-center gap-2 text-lg shrink-0 tracking-tight">
          <User className="h-4 w-4 text-primary" weight="duotone" />
          用户列表
        </CardTitle>
        <form onSubmit={submitSearch} className="flex w-full gap-2 sm:max-w-sm">
          <Input
            id="admin-user-search"
            name="adminUserSearch"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索用户名、昵称或邮箱"
            className="min-w-0"
          />
          <Button type="submit" variant="outline" size="sm">
            筛选
          </Button>
        </form>
      </CardHeader>
      <CardContent>
        {!users && <Skeleton className="h-40 w-full" />}
        {users && (
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarUrl(u.avatarSeed)}
                  alt=""
                  width={40}
                  height={40}
                  className="rounded-full bg-muted shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-serif text-[1rem] font-semibold truncate text-foreground">
                      {u.displayName ?? u.username}
                    </span>
                    {u.role === "admin" && (
                      <Badge variant="success" className="text-[9px] small-caps">
                        <ShieldStar className="h-2.5 w-2.5" weight="fill" />
                        admin
                      </Badge>
                    )}
                    {u.disabled && (
                      <Badge variant="destructive" className="small-caps">
                        已禁用
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate font-mono tabular-nums">
                    {u.username} · 注册于{" "}
                    {new Date(u.createdAt).toLocaleDateString()}
                    {u.lastLoginAt && (
                      <>
                        {" · 最后登录 "}
                        {new Date(u.lastLoginAt).toLocaleString()}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">
                    {u.manuscripts} 份稿件
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void changeRole(u)}
                  >
                    {u.role === "admin" ? "降为用户" : "设为管理员"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="注销会话"
                    onClick={() => void forceLogout(u)}
                  >
                    <SignOut className="h-4 w-4" weight="duotone" />
                  </Button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {u.disabled ? "禁用" : "启用"}
                    </span>
                    <Switch
                      checked={!u.disabled}
                      onCheckedChange={(v) => void toggleDisable(u, !v)}
                      aria-label={`${u.username} 账户启用状态`}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {users && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-xs text-muted-foreground tabular-nums font-mono">
              {pageStart}-{pageEnd} / {total}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((v) => v + PAGE_SIZE)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
