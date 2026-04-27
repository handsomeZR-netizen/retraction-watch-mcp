"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarBlank,
  CaretRight,
  Crown,
  Plus,
  ShieldCheck,
  UsersThree,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface WS {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
  created_at: string;
}

export default function WorkspacesPage() {
  const [list, setList] = useState<WS[] | null>(null);

  async function load() {
    const res = await fetch("/api/workspaces");
    if (!res.ok) {
      toast.error("加载失败");
      return;
    }
    const j = (await res.json()) as { workspaces: WS[] };
    setList(j.workspaces);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createNew() {
    const name = prompt("新团队空间名称：");
    if (!name) return;
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error("创建失败");
      return;
    }
    const j = (await res.json()) as { workspace: WS };
    toast.success(`已创建：${j.workspace.name}`);
    await load();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <UsersThree className="h-7 w-7" weight="duotone" />
            团队空间
          </h1>
          <p className="text-sm text-muted-foreground">
            团队空间内的成员共享上传的稿件和历史记录。
          </p>
        </div>
        <Button onClick={createNew}>
          <Plus className="h-4 w-4" weight="bold" />
          新建空间
        </Button>
      </header>

      {!list && <Skeleton className="h-32 w-full" />}
      {list && list.length === 0 && (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          还没有任何团队空间。点击右上角创建一个，或者从邀请链接加入。
        </Card>
      )}
      {list && list.length > 0 && (
        <div className="space-y-2">
          {list.map((w) => (
            <Link key={w.id} href={`/workspaces/${w.id}`}>
              <Card className="p-4 flex items-center gap-3 hover:bg-accent/30 transition-colors cursor-pointer">
                <span className="grid h-10 w-10 place-items-center rounded-md bg-muted shrink-0">
                  <UsersThree className="h-5 w-5" weight="duotone" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{w.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                    <span className="font-mono">{w.slug}</span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarBlank className="h-3 w-3" weight="duotone" />
                      {new Date(w.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {w.role === "owner" ? (
                  <Badge variant="success">
                    <Crown className="h-2.5 w-2.5" weight="fill" /> owner
                  </Badge>
                ) : w.role === "admin" ? (
                  <Badge variant="secondary">
                    <ShieldCheck className="h-2.5 w-2.5" weight="fill" /> admin
                  </Badge>
                ) : (
                  <Badge variant="muted">member</Badge>
                )}
                <CaretRight className="h-4 w-4 text-muted-foreground" weight="bold" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
