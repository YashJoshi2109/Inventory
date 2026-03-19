import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
  glow?: boolean;
}

export function Card({ className, glass = false, glow = false, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl transition-all duration-200",
        glass
          ? "glass"
          : "rounded-2xl",
        glow && "card-glow",
        className,
      )}
      style={
        glass
          ? undefined
          : {
              background: "rgba(7,15,31,0.6)",
              border: "1px solid rgba(255,255,255,0.07)",
              backdropFilter: "blur(12px)",
            }
      }
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("px-5 py-4", className)}
      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
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
      style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.1)" }}
      {...props}
    />
  );
}
