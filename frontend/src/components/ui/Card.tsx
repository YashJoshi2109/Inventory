import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
  glow?: boolean;
  elevated?: boolean;
  noPad?: boolean;
}

export function Card({
  className,
  glass = false,
  glow = false,
  elevated = false,
  noPad = false,
  ...props
}: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl transition-all duration-200",
        elevated ? "glass-elevated" : "glass",
        glow && "card-hover",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("px-5 py-4", className)}
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
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
      className={clsx("px-5 py-3 rounded-b-2xl", className)}
      style={{
        borderTop: "1px solid var(--border-subtle)",
        background: "rgba(var(--accent-rgb, 37,99,235), 0.02)",
      }}
      {...props}
    />
  );
}
