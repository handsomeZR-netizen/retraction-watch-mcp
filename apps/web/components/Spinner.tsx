import clsx from "clsx";

export function Spinner({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={clsx("spinner", size === "lg" && "spinner-lg")}
      aria-label="loading"
    />
  );
}
