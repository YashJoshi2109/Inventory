import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
}

export function Card({ className, glass = false, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-surface-border",
        glass
          ? "bg-surface-card/60 backdrop-blur-sm"
          : "bg-surface-card",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("px-5 py-4 border-b border-surface-border", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("px-5 py-3 border-t border-surface-border bg-surface/30 rounded-b-xl", className)}
      {...props}
    />
  );
}
