"use client";

import { type ReactNode } from "react";
import { Trash, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  /** Controls visibility. The parent owns the boolean. */
  open: boolean;
  /** Called when the dialog should close (Cancel, ESC, click-outside). */
  onClose: () => void;
  /** Called when the user clicks the destructive confirm button. */
  onConfirm: () => void | Promise<void>;
  /** Title shown at the top of the dialog. */
  title?: string;
  /** Body text describing what will happen. */
  description?: ReactNode;
  /** Confirm button label. Defaults to 删除. */
  confirmLabel?: string;
  /** When true, the confirm button is disabled and shows a spinner-ish label. */
  busy?: boolean;
}

/**
 * Reusable destructive-action confirm dialog. Replaces native window.confirm
 * across the app so the UX matches the rest of the design (radix dialog,
 * focus trap, ESC support, click-outside). Always render styled — prefer
 * this over a string-only browser prompt for anything that touches the DB
 * or filesystem.
 */
export function ConfirmDeleteDialog({
  open,
  onClose,
  onConfirm,
  title = "确认删除？",
  description,
  confirmLabel = "删除",
  busy = false,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Warning className="h-5 w-5" weight="duotone" />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash className="mr-1 h-4 w-4" weight="duotone" />
            {busy ? "正在删除…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
