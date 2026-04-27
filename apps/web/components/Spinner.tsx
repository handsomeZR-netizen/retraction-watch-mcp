import { cn } from "@/lib/utils";

export function Spinner({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={cn("spinner", size === "lg" && "spinner-lg")}
      aria-label="loading"
    />
  );
}
