import { clsx } from "clsx";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "purple";

const variants: Record<BadgeVariant, string> = {
  default: "bg-slate-700 text-slate-300",
  success: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30",
  danger: "bg-red-500/15 text-red-400 ring-1 ring-red-500/30",
  info: "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30",
  purple: "bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/30",
};

interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
}

export function Badge({ variant = "default", className, children, dot }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
    >
      {dot && (
        <span
          className={clsx(
            "w-1.5 h-1.5 rounded-full",
            variant === "success" && "bg-emerald-400",
            variant === "warning" && "bg-amber-400",
            variant === "danger" && "bg-red-400",
            variant === "info" && "bg-blue-400",
            variant === "default" && "bg-slate-400"
          )}
        />
      )}
      {children}
    </span>
  );
}
