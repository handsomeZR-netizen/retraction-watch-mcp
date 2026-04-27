import { CircleNotch, FileText } from "@phosphor-icons/react/dist/ssr";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ResultLoading() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <Skeleton className="h-8 w-28" />
      <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card className="h-[calc(100vh-9rem)] overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" weight="duotone" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex-1 grid place-items-center bg-muted/30">
            <div className="text-center space-y-3">
              <CircleNotch
                className="h-8 w-8 text-muted-foreground mx-auto animate-spin"
                weight="bold"
              />
              <p className="text-xs text-muted-foreground">加载原文预览…</p>
            </div>
          </div>
        </Card>

        <div className="space-y-6 min-w-0">
          <Card className="p-6 space-y-5">
            <div className="space-y-2">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-7 w-3/4" />
              <div className="flex gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
            <Skeleton className="h-px w-full" />
            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          </Card>
          <Card className="p-5 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
        </div>
      </div>
    </div>
  );
}
