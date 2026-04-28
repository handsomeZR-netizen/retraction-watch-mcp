"use client";

import { useEffect, useState } from "react";
import { CaretDown, UserCircle, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Member {
  id: string;
  username: string;
  displayName: string | null;
  avatarSeed: string | null;
  role?: string;
}

interface PickerData {
  assignee: Member | null;
  candidates: Member[];
}

/**
 * Workspace-scope reviewer assignment. Only renders meaningfully when the
 * manuscript is in a workspace; in personal scope the API returns an empty
 * candidate list and the picker hides itself.
 */
export function AssigneePicker({ manuscriptId }: { manuscriptId: string }) {
  const [data, setData] = useState<PickerData | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`/api/manuscripts/${manuscriptId}/assignee`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setData(j));
  }, [manuscriptId]);

  if (!data) return null;
  if (data.candidates.length === 0 && !data.assignee) return null;

  const update = async (next: string | null) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/manuscripts/${manuscriptId}/assignee`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId: next }),
      });
      if (res.ok) {
        const j = (await res.json()) as { assignee: Member | null };
        setData((prev) => (prev ? { ...prev, assignee: j.assignee } : prev));
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCircle className="h-4 w-4 text-muted-foreground" weight="duotone" />
          审稿人指派
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          {data.assignee ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Avatar member={data.assignee} />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {data.assignee.displayName ?? data.assignee.username}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  @{data.assignee.username}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update(null)}
                disabled={busy}
                title="取消指派"
                className="ml-auto"
              >
                <X className="h-3.5 w-3.5" weight="bold" />
              </Button>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground flex-1">未指派</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            disabled={busy || data.candidates.length === 0}
          >
            {data.assignee ? "改派" : "指派"}
            <CaretDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} weight="bold" />
          </Button>
        </div>
        {open && data.candidates.length > 0 && (
          <ul className="border rounded-md divide-y divide-border max-h-60 overflow-auto animate-fade-in-up">
            {data.candidates.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors text-sm",
                    data.assignee?.id === m.id && "bg-accent",
                  )}
                  onClick={() => update(m.id)}
                  disabled={busy}
                >
                  <Avatar member={m} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">
                      {m.displayName ?? m.username}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      @{m.username} {m.role && `· ${m.role}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Avatar({ member }: { member: Member }) {
  const initial = (member.displayName ?? member.username).charAt(0).toUpperCase();
  return (
    <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-foreground text-xs font-semibold shrink-0">
      {initial}
    </span>
  );
}
