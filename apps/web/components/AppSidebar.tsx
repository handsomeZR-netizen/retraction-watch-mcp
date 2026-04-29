"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SidebarSimple,
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
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
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
  const { active, dismiss, refreshToken, bumpRefreshToken } = useSessions();
  const [items, setItems] = useState<ManuscriptItem[] | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<ManuscriptItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [recentOpen, setRecentOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Pending-delete state drives the ConfirmDeleteDialog. Replaces native
  // window.confirm so the prompt matches the rest of the design system and
  // doesn't get blocked by some browsers' notification settings.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Persist collapsed state in localStorage so it survives navigation.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("rw:sidebar-collapsed");
      if (stored === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("rw:sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const load = useCallback(async () => {
    // Single round-trip: /api/sidebar bundles items + archivedItems + projects.
    const res = await fetch("/api/sidebar", { cache: "no-store" });
    if (!res.ok) return;
    const j = await res.json();
    setItems(j.items ?? []);
    setProjects(j.projects ?? []);
    setArchivedItems(j.archivedItems ?? []);
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

  async function performDelete(id: string) {
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/manuscripts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("删除失败");
        return;
      }
      toast.success("已删除");
      // Bump the shared refresh token first — that wakes up history page,
      // workspace sidebar, etc. — and then load() refreshes our own list.
      bumpRefreshToken();
      await load();
    } finally {
      setDeleteBusy(false);
      setPendingDeleteId(null);
    }
  }

  if (collapsed) {
    return (
      <aside className="hidden md:flex w-14 shrink-0 border-r border-border bg-card flex-col h-screen sticky top-0">
        <div className="p-2 border-b border-border flex flex-col items-center gap-2">
          <Link
            href="/"
            className="grid h-9 w-9 place-items-center rounded-md bg-foreground text-background text-[11px] font-bold tracking-wider"
            title="RW Screen"
          >
            RW
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCollapsed(false)}
            title="展开侧栏"
          >
            <SidebarSimple className="h-4 w-4" weight="duotone" />
          </Button>
          <Button
            asChild
            variant="default"
            size="icon"
            className="h-9 w-9"
            title="新筛查会话"
          >
            <Link href="/">
              <PlusCircle className="h-4 w-4" weight="bold" />
            </Link>
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1">
          {active.slice(0, 6).map((s) => (
            <CollapsedSessionDot key={s.manuscriptId} session={s} active={pathname.includes(s.manuscriptId)} />
          ))}
        </div>
        <div className="p-2 border-t border-border flex flex-col items-center gap-1">
          <CollapsedNavIcon href="/" icon={House} label="首页" pathname={pathname} />
          <CollapsedNavIcon href="/history" icon={ClockCounterClockwise} label="历史" pathname={pathname} />
          <CollapsedNavIcon href="/admin" icon={ShieldStar} label="管理" pathname={pathname} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-card flex-col h-screen sticky top-0 overflow-hidden">
      <div className="px-3 py-3 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-2 px-1.5 min-w-0">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-background text-[11px] font-bold tracking-wider shrink-0"
            >
              RW
            </span>
            <span className="text-sm font-semibold tracking-tight truncate">RW Screen</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setCollapsed(true)}
            title="折叠侧栏"
          >
            <SidebarSimple className="h-4 w-4" weight="duotone" />
          </Button>
        </div>
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
                          onDelete={() => setPendingDeleteId(it.id)}
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
                onDelete={() => setPendingDeleteId(it.id)}
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
                  onDelete={() => setPendingDeleteId(it.id)}
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
      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) void performDelete(pendingDeleteId);
        }}
        busy={deleteBusy}
        title="确认删除该稿件？"
        description={
          <>
            将永久删除磁盘上的稿件副本、解析结果、审稿备注以及所有有效的只读分享链接。
            <br />
            历史 audit log 中的解析记录会保留以便审计。
          </>
        }
      />
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
  const stageLabel: Record<string, string> = {
    uploaded: "已上传",
    text_extracted: "文本提取",
    metadata_extracted: "元数据",
    authors_screened: "作者比对",
    refs_segmented: "切分参考文献",
    refs_structured: "结构化",
    screening: "比对中",
  };
  const stageText =
    session.status === "done"
      ? "完成"
      : session.status === "deduped"
        ? "已复用"
        : session.status === "error"
          ? "错误"
          : session.status === "uploading"
            ? "上传中"
            : (session.stage && stageLabel[session.stage]) ?? "解析中";
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
        <div className="text-xs font-medium truncate" title={session.fileName}>
          {session.fileName}
        </div>
        {session.status !== "done" && session.status !== "error" && session.status !== "deduped" ? (
          <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground/60 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{stageText}</div>
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

function CollapsedSessionDot({
  session,
  active,
}: {
  session: ActiveSession;
  active: boolean;
}) {
  const Icon =
    session.status === "done" || session.status === "deduped"
      ? CheckCircle
      : session.status === "error"
        ? Warning
        : CircleNotch;
  const cls =
    session.status === "done" || session.status === "deduped"
      ? "text-success"
      : session.status === "error"
        ? "text-destructive"
        : "text-foreground/70 animate-spin";
  const isLink = session.status === "done" || session.status === "deduped";
  const inner = (
    <span
      className={cn(
        "grid h-9 w-9 place-items-center rounded-md transition-colors",
        active ? "bg-accent" : "hover:bg-accent/40",
      )}
      title={`${session.fileName}`}
    >
      <Icon className={cn("h-4 w-4", cls)} weight={session.status === "done" ? "fill" : "bold"} />
    </span>
  );
  return isLink ? <Link href={`/result/${session.manuscriptId}`}>{inner}</Link> : inner;
}

function CollapsedNavIcon({
  href,
  icon: Icon,
  label,
  pathname,
}: {
  href: string;
  icon: PIcon;
  label: string;
  pathname: string;
}) {
  const active = pathname === href;
  return (
    <Link
      href={href}
      title={label}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-md transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
      )}
    >
      <Icon className="h-4 w-4" weight="duotone" />
    </Link>
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

  // Hover-driven dropdown: opening on hover (not just on click) was the
  // user's UX request — see the v0.4.9 thread. We keep it controlled so
  // we can debounce the close on mouseleave (otherwise tracking the cursor
  // from the trigger across the gap into the menu content immediately
  // closes it). Brief 120 ms delay matches GitHub / Linear conventions.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setMenuOpen(false), 120);
  };
  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  return (
    <div
      className={cn(
        "px-2 py-1.5 rounded-md flex items-center gap-2 group",
        isActive ? "bg-accent" : "hover:bg-accent/40 transition-colors",
      )}
      onMouseEnter={() => { cancelClose(); setMenuOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        onClick={onSelect}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
      >
        <StatusIcon
          className={cn("h-3.5 w-3.5 shrink-0", statusCls)}
          weight={verdict ? "fill" : "duotone"}
        />
        <span className="text-xs truncate min-w-0 flex-1 block">{item.title ?? item.fileName}</span>
      </button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
