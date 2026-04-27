"use client";

import { useEffect, useState } from "react";
import { ShieldStar, User } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function AdminUsersTable() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);

  async function load() {
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      toast.error("加载失败");
      return;
    }
    const j = (await res.json()) as { users: AdminUser[] };
    setUsers(j.users);
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleDisable(u: AdminUser, disabled: boolean) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error ?? "操作失败");
      return;
    }
    toast.success(disabled ? "已禁用" : "已启用");
    setUsers((prev) =>
      prev?.map((row) => (row.id === u.id ? { ...row, disabled } : row)) ?? prev,
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4" weight="duotone" />
          用户列表
        </CardTitle>
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
                    <span className="font-medium truncate">
                      {u.displayName ?? u.username}
                    </span>
                    {u.role === "admin" && (
                      <Badge variant="success" className="text-[9px]">
                        <ShieldStar className="h-2.5 w-2.5" weight="fill" />
                        admin
                      </Badge>
                    )}
                    {u.disabled && <Badge variant="destructive">已禁用</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {u.username} · 注册于 {new Date(u.createdAt).toLocaleDateString()}
                    {u.lastLoginAt && (
                      <>
                        {" · 最后登录 "}
                        {new Date(u.lastLoginAt).toLocaleString()}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-mono">
                    {u.manuscripts} 份稿件
                  </span>
                  <Switch
                    checked={!u.disabled}
                    onCheckedChange={(v) => void toggleDisable(u, !v)}
                    aria-label={u.disabled ? "启用账户" : "禁用账户"}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
