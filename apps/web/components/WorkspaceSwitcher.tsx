"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CaretDown,
  Check,
  House,
  Plus,
  UsersThree,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WS {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

interface Profile {
  activeWorkspaceId?: string | null;
}

export function WorkspaceSwitcher() {
  const router = useRouter();
  const [list, setList] = useState<WS[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  async function load() {
    const [listRes, meRes] = await Promise.all([
      fetch("/api/workspaces"),
      fetch("/api/account/profile"),
    ]);
    if (listRes.ok) {
      const j = (await listRes.json()) as { workspaces: WS[] };
      setList(j.workspaces);
    }
    if (meRes.ok) {
      const me = (await meRes.json()) as Profile & { activeWorkspaceId?: string };
      setActiveId(me.activeWorkspaceId ?? null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function pick(id: string | null) {
    const res = await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    });
    if (!res.ok) {
      toast.error("切换失败");
      return;
    }
    setActiveId(id);
    toast.success(id ? "已切换到团队空间" : "已切换到个人空间");
    router.refresh();
  }

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
    await pick(j.workspace.id);
    router.push(`/workspaces/${j.workspace.id}`);
  }

  if (!list) return null;
  const active = list.find((w) => w.id === activeId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 h-8 px-2.5">
          {active ? (
            <UsersThree className="h-4 w-4" weight="duotone" />
          ) : (
            <House className="h-4 w-4" weight="duotone" />
          )}
          <span className="text-sm hidden md:inline truncate max-w-[140px]">
            {active ? active.name : "个人空间"}
          </span>
          <CaretDown className="h-3 w-3 text-muted-foreground" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>切换空间</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => pick(null)}>
          <House className="h-4 w-4" weight="duotone" />
          <span className="flex-1">个人空间</span>
          {!activeId && <Check className="h-3.5 w-3.5" weight="bold" />}
        </DropdownMenuItem>
        {list.length > 0 && <DropdownMenuSeparator />}
        {list.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => pick(w.id)}>
            <UsersThree className="h-4 w-4" weight="duotone" />
            <div className="flex-1 min-w-0">
              <div className="truncate">{w.name}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {w.role}
              </div>
            </div>
            {activeId === w.id && <Check className="h-3.5 w-3.5" weight="bold" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={createNew}>
          <Plus className="h-4 w-4" weight="bold" />
          新建团队空间
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/workspaces")}>
          <UsersThree className="h-4 w-4" weight="duotone" />
          管理空间
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
