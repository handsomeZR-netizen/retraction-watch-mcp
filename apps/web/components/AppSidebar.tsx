"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  DotsThreeVertical,
  FileText,
  Folder,
  FolderPlus,
  House,
  MagnifyingGlass,
  PlusCircle,
  ShieldStar,
  Sparkle,
  TrashSimple,
  Warning,
  XCircle,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSessions, type ActiveSession, progressPercent } from "@/components/sessions/SessionsContext";
import { cn } from "@/lib/utils";

interface ManuscriptItem {
  id: string;
  fileName: string;
  fileType: string;
  uploadedAt: string;
  status: "parsing" | "done" | "error";
  verdict: "PASS" | "REVIEW" | "FAIL" | null;
  title: string | null;
  projectId: string | null;
  archived: boolean;
}

interface ProjectItem {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

const VERDICT_META: Record<string, { Icon: PIcon; cls: string }> = {
  PASS: { Icon: CheckCircle, cls: "text-success" },
  REVIEW: { Icon: Warning, cls: "text-warning" },
  FAIL: { Icon: XCircle, cls: "text-destructive" },
};

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { active, dismiss, refreshToken } = useSessions();
  const [items, setItems] = useState<ManuscriptItem[] | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<ManuscriptItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [recentOpen, setRecentOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const load = useCallback(async () => {
    const [m, p, a] = await Promise.all([
      fetch("/api/manuscripts?limit=80&archived=false", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/manuscripts?limit=30&archived=true", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setItems(m.items ?? []);
    setProjects(p.projects ?? []);
    setArchivedItems(a.items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const activeIds = useMemo(() => new Set(active.map((s) => s.manuscriptId)), [active]);
  const visibleItems = useMemo(() => {
    if (!items) return null;
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (activeIds.has(it.id)) return false; // shown in "进行中"
      if (!q) return true;
      return (
        it.fileName.toLowerCase().includes(q) ||
        (it.title ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, activeIds, search]);

  const itemsByProject = useMemo(() => {
    const map = new Map<string, ManuscriptItem[]>();
    if (!visibleItems) return map;
    for (const it of visibleItems) {
      const key = it.projectId ?? "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return map;
  }, [visibleItems]);

  function toggleProject(id: string) {
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createProject() {
    const name = prompt("新建项目名称：");
    if (!name) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error("创建失败");
      return;
    }
    toast.success(`项目已创建：${name}`);
    await load();
  }

  async function organize(
    manuscriptId: string,
    body: { projectId?: string | null; archived?: boolean },
  ) {
    const res = await fetch(`/api/manuscripts/${manuscriptId}/organize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("操作失败");
      return;
    }
    await load();
  }

  async function deleteManuscript(id: string) {
    if (!confirm("确认删除该稿件？此操作不可撤销。")) return;
    const res = await fetch(`/api/manuscripts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("删除失败");
      return;
    }
    await load();
  }

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col h-screen sticky top-0 overflow-hidden">
      <div className="px-3 py-3 border-b border-border space-y-2 shrink-0">
        <Link href="/" className="flex items-center gap-2 px-1.5">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-background text-[11px] font-bold tracking-wider"
          >
            RW
          </span>
          <span className="text-sm font-semibold tracking-tight">RW Screen</span>
        </Link>
        <Button
          asChild
          variant="default"
          size="sm"
          className="w-full justify-start gap-2"
        >
          <Link href="/">
            <PlusCircle className="h-4 w-4" weight="bold" />
            新筛查会话
          </Link>
        </Button>
        <div className="relative">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索会话"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 py-2 space-y-3">
          {/* In-progress sessions */}
          {active.length > 0 && (
            <Section
              icon={Sparkle}
              label="进行中"
              count={active.length}
              defaultOpen
            >
              {active.map((s) => (
                <ActiveSessionRow
                  key={s.manuscriptId}
                  session={s}
                  active={pathname.includes(s.manuscriptId)}
                  onDismiss={() => dismiss(s.manuscriptId)}
                />
              ))}
            </Section>
          )}

          {/* Projects */}
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 h-7">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                项目 ({projects.length})
              </span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={createProject}>
                <FolderPlus className="h-3.5 w-3.5" weight="bold" />
              </Button>
            </div>
            {projects.length === 0 && (
              <div className="px-2 text-[11px] text-muted-foreground">
                暂无项目，点击 + 创建
              </div>
            )}
            {projects.map((p) => {
              const pItems = itemsByProject.get(p.id) ?? [];
              const open = openProjects.has(p.id);
              return (
                <Collapsible
                  key={p.id}
                  open={open}
                  onOpenChange={() => toggleProject(p.id)}
                >
                  <CollapsibleTrigger asChild>
                    <button className="w-full px-2 py-1.5 rounded-md hover:bg-accent/40 transition-colors flex items-center gap-1.5 text-sm group">
                      {open ? (
                        <CaretDown className="h-3 w-3 text-muted-foreground shrink-0" weight="bold" />
                      ) : (
                        <CaretRight className="h-3 w-3 text-muted-foreground shrink-0" weight="bold" />
                      )}
                      <Folder
                        className="h-3.5 w-3.5 shrink-0"
                        weight="duotone"
                        style={p.color ? { color: p.color } : undefined}
                      />
                      <span className="truncate flex-1 text-left">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{p.count}</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="ml-4 mt-0.5 space-y-0.5">
                    {pItems.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground">空</div>
                    ) : (
                      pItems.map((it) => (
                        <SessionRow
                          key={it.id}
                          item={it}
                          isActive={pathname.includes(it.id)}
                          onSelect={() => router.push(`/result/${it.id}`)}
                          onMove={(pid) => organize(it.id, { projectId: pid })}
                          onArchive={() => organize(it.id, { archived: true })}
                          onDelete={() => deleteManuscript(it.id)}
                          projects={projects}
                        />
                      ))
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>

          {/* Recent (no project) */}
          <Section
            icon={ClockCounterClockwise}
            label="最近"
            count={(itemsByProject.get("__none__") ?? []).length}
            defaultOpen
            open={recentOpen}
            onOpenChange={setRecentOpen}
          >
            {(itemsByProject.get("__none__") ?? []).slice(0, 30).map((it) => (
              <SessionRow
                key={it.id}
                item={it}
                isActive={pathname.includes(it.id)}
                onSelect={() => router.push(`/result/${it.id}`)}
                onMove={(pid) => organize(it.id, { projectId: pid })}
                onArchive={() => organize(it.id, { archived: true })}
                onDelete={() => deleteManuscript(it.id)}
                projects={projects}
              />
            ))}
            {!visibleItems && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">加载中…</div>
            )}
          </Section>

          {/* Archived */}
          {archivedItems && archivedItems.length > 0 && (
            <Section
              icon={Archive}
              label="已归档"
              count={archivedItems.length}
              open={archivedOpen}
              onOpenChange={setArchivedOpen}
            >
              {archivedItems.slice(0, 30).map((it) => (
                <SessionRow
                  key={it.id}
                  item={it}
                  isActive={pathname.includes(it.id)}
                  onSelect={() => router.push(`/result/${it.id}`)}
                  onMove={(pid) => organize(it.id, { projectId: pid })}
                  onArchive={() => organize(it.id, { archived: false })}
                  onDelete={() => deleteManuscript(it.id)}
                  projects={projects}
                  archivedView
                />
              ))}
            </Section>
          )}
        </div>
      </ScrollArea>

      <div className="px-3 py-2 border-t border-border space-y-0.5 shrink-0">
        <NavLink href="/" icon={House} label="首页" pathname={pathname} />
        <NavLink href="/history" icon={ClockCounterClockwise} label="历史" pathname={pathname} />
        <NavLink href="/admin" icon={ShieldStar} label="管理" pathname={pathname} adminOnly />
      </div>
    </aside>
  );
}

function Section({
  icon: Icon,
  label,
  count,
  defaultOpen,
  open,
  onOpenChange,
  children,
}: {
  icon: PIcon;
  label: string;
  count: number;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between px-2 h-7 hover:bg-accent/30 rounded-md transition-colors text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          <span className="flex items-center gap-1.5">
            <Icon className="h-3 w-3" weight="duotone" />
            {label}
          </span>
          <span className="tabular-nums">{count}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 mt-0.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ActiveSessionRow({
  session,
  active,
  onDismiss,
}: {
  session: ActiveSession;
  active: boolean;
  onDismiss: () => void;
}) {
  const pct = progressPercent(session);
  const Icon =
    session.status === "done" || session.status === "deduped"
      ? CheckCircle
      : session.status === "error"
        ? Warning
        : CircleNotch;
  const iconCls =
    session.status === "done" || session.status === "deduped"
      ? "text-success"
      : session.status === "error"
        ? "text-destructive"
        : "text-foreground/70 animate-spin";
  const isLink = session.status === "done" || session.status === "deduped";
  const inner = (
    <div
      className={cn(
        "px-2 py-1.5 rounded-md flex items-center gap-2 group w-full",
        active ? "bg-accent" : "hover:bg-accent/40 transition-colors",
      )}
    >
      <Icon
        className={cn("h-3.5 w-3.5 shrink-0", iconCls)}
        weight={session.status === "done" ? "fill" : "bold"}
        style={
          session.status !== "done" && session.status !== "error" && session.status !== "deduped"
            ? { animationDuration: "1.4s" }
            : undefined
        }
      />
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="text-xs font-medium truncate">{session.fileName}</div>
        {session.status !== "done" && session.status !== "error" && (
          <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground/60 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {session.message && (
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {session.message}
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
        title="从列表移除"
      >
        <XCircle className="h-3.5 w-3.5" weight="bold" />
      </button>
    </div>
  );
  return isLink ? (
    <Link href={`/result/${session.manuscriptId}`} className="block w-full min-w-0">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function SessionRow({
  item,
  isActive,
  onSelect,
  onMove,
  onArchive,
  onDelete,
  projects,
  archivedView,
}: {
  item: ManuscriptItem;
  isActive: boolean;
  onSelect: () => void;
  onMove: (projectId: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
  projects: ProjectItem[];
  archivedView?: boolean;
}) {
  const verdict = item.verdict ? VERDICT_META[item.verdict] : null;
  const StatusIcon =
    item.status === "parsing"
      ? CircleNotch
      : item.status === "error"
        ? Warning
        : verdict?.Icon ?? FileText;
  const statusCls =
    item.status === "parsing"
      ? "text-muted-foreground animate-spin"
      : item.status === "error"
        ? "text-destructive"
        : verdict?.cls ?? "text-muted-foreground";

  return (
    <div
      className={cn(
        "px-2 py-1.5 rounded-md flex items-center gap-2 group",
        isActive ? "bg-accent" : "hover:bg-accent/40 transition-colors",
      )}
    >
      <button
        onClick={onSelect}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
      >
        <StatusIcon
          className={cn("h-3.5 w-3.5 shrink-0", statusCls)}
          weight={verdict ? "fill" : "duotone"}
        />
        <span className="text-xs truncate">{item.title ?? item.fileName}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <DotsThreeVertical className="h-4 w-4" weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Folder className="h-4 w-4" weight="duotone" />
              移到项目
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => onMove(null)}>
                <span className="text-muted-foreground">无项目</span>
              </DropdownMenuItem>
              {projects.length > 0 && <DropdownMenuSeparator />}
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => onMove(p.id)}>
                  <Folder
                    className="h-4 w-4"
                    weight="duotone"
                    style={p.color ? { color: p.color } : undefined}
                  />
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="h-4 w-4" weight="duotone" />
            {archivedView ? "取消归档" : "归档"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            <TrashSimple className="h-4 w-4" weight="bold" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  pathname,
  adminOnly,
}: {
  href: string;
  icon: PIcon;
  label: string;
  pathname: string;
  adminOnly?: boolean;
}) {
  void adminOnly;
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 px-2 h-8 rounded-md text-sm transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
      )}
    >
      <Icon className="h-4 w-4" weight="duotone" />
      {label}
    </Link>
  );
}
