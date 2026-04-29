import * as React from "react";
import { cn } from "@/lib/utils";

type AsProp<T extends React.ElementType> = {
  as?: T;
};

type PolymorphicProps<T extends React.ElementType, P = unknown> = AsProp<T> &
  Omit<React.ComponentPropsWithoutRef<T>, keyof AsProp<T> | keyof P> &
  P;

export const PageTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h1
    ref={ref}
    className={cn(
      "font-serif text-3xl sm:text-[2rem] font-semibold tracking-tight leading-tight text-foreground",
      className,
    )}
    {...props}
  />
));
PageTitle.displayName = "PageTitle";

export const SectionTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn(
      "font-serif text-xl font-semibold tracking-tight leading-snug text-foreground",
      className,
    )}
    {...props}
  />
));
SectionTitle.displayName = "SectionTitle";

export const SubsectionTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "font-serif text-base font-semibold leading-snug text-foreground",
      className,
    )}
    {...props}
  />
));
SubsectionTitle.displayName = "SubsectionTitle";

export const Lead = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      "font-serif text-base sm:text-lg text-muted-foreground leading-relaxed",
      className,
    )}
    {...props}
  />
));
Lead.displayName = "Lead";

export const Prose = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "prose prose-academic max-w-none text-foreground/90 prose-p:my-3 prose-li:my-1",
      className,
    )}
    {...props}
  />
));
Prose.displayName = "Prose";

export const Blockquote = React.forwardRef<
  HTMLQuoteElement,
  React.HTMLAttributes<HTMLQuoteElement>
>(({ className, ...props }, ref) => (
  <blockquote
    ref={ref}
    className={cn(
      "font-serif border-l-2 border-primary/70 pl-4 py-1 text-foreground/80 italic-0 leading-relaxed",
      className,
    )}
    {...props}
  />
));
Blockquote.displayName = "Blockquote";

export function InlineCode({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        "font-mono text-[0.85em] bg-muted/60 text-foreground rounded px-1.5 py-0.5 border border-border/60",
        className,
      )}
      {...props}
    />
  );
}

export function Footnote({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-xs text-muted-foreground leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export function Eyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "small-caps text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MonoText({
  as: Component = "span",
  className,
  ...props
}: PolymorphicProps<"span"> & {
  as?: "span" | "code" | "div";
}) {
  return (
    <Component
      className={cn("font-mono tabular-nums text-[0.95em]", className)}
      {...props}
    />
  );
}
