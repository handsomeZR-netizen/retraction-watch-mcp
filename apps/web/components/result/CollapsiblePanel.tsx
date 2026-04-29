"use client";

import { useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  /** Optional left-side icon shown in the trigger button. */
  icon?: ReactNode;
  /** Trigger label (visible at all times). */
  label: string;
  /** Optional secondary text on the right (e.g. status hint). */
  hint?: string;
  /** Whether the panel is initially expanded. Defaults to false. */
  defaultOpen?: boolean;
  /** The panel body — usually an existing <Card> that already styles itself. */
  children: ReactNode;
}

/**
 * Compact collapsible row used to hide auxiliary tools (share-link manager,
 * reviewer notes, assignee picker) on the result page so they don't drown
 * out the verdict evidence above. The trigger is a single-line button (~40 px
 * tall); content slides via the accordion keyframes from tailwind.config.ts
 * for a ~200 ms ease-out feel. The content slot has no border/padding of its
 * own — children style themselves (typically with <Card>).
 */
export function CollapsiblePanel({
  icon,
  label,
  hint,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-md border bg-card text-sm",
            "hover:bg-accent/50 transition-colors text-left",
          )}
        >
          {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
          <span className="font-medium">{label}</span>
          {hint && (
            <span className="text-xs text-muted-foreground truncate">{hint}</span>
          )}
          <CaretDown
            className={cn(
              "ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
              open && "rotate-180",
            )}
            weight="bold"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          "overflow-hidden",
          "data-[state=open]:animate-accordion-down",
          "data-[state=closed]:animate-accordion-up",
        )}
      >
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
