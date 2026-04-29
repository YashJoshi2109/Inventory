import { clsx } from "clsx";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger" | "info" | "violet" | "purple";

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  default: {
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border-subtle)",
  },
  primary: {
    background: "rgba(var(--accent-rgb, 37,99,235), 0.12)",
    color: "var(--accent)",
    border: "1px solid rgba(var(--accent-rgb, 37,99,235), 0.3)",
  },
  success: {
    background: "rgba(var(--accent-success-rgb, 5,150,105), 0.12)",
    color: "var(--accent-success)",
    border: "1px solid rgba(var(--accent-success-rgb, 5,150,105), 0.3)",
  },
  warning: {
    background: "rgba(var(--accent-warning-rgb, 217,119,6), 0.12)",
    color: "var(--accent-warning)",
    border: "1px solid rgba(var(--accent-warning-rgb, 217,119,6), 0.3)",
  },
  danger: {
    background: "rgba(var(--accent-danger-rgb, 220,38,38), 0.12)",
    color: "var(--accent-danger)",
    border: "1px solid rgba(var(--accent-danger-rgb, 220,38,38), 0.3)",
  },
  info: {
    background: "rgba(6,182,212, 0.12)",
    color: "#0891b2",
    border: "1px solid rgba(6,182,212, 0.3)",
  },
  violet: {
    background: "rgba(var(--accent-violet-rgb, 124,58,237), 0.12)",
    color: "var(--accent-violet)",
    border: "1px solid rgba(var(--accent-violet-rgb, 124,58,237), 0.3)",
  },
  // "purple" kept as alias for violet for backward compatibility
  purple: {
    background: "rgba(var(--accent-violet-rgb, 124,58,237), 0.12)",
    color: "var(--accent-violet)",
    border: "1px solid rgba(var(--accent-violet-rgb, 124,58,237), 0.3)",
  },
};

const dotColors: Record<BadgeVariant, string> = {
  default: "var(--text-muted)",
  primary: "var(--accent)",
  success: "var(--accent-success)",
  warning: "var(--accent-warning)",
  danger: "var(--accent-danger)",
  info: "#0891b2",
  violet: "var(--accent-violet)",
  purple: "var(--accent-violet)",
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
      className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5", className)}
      style={{
        fontFamily: "'Outfit', sans-serif",
        fontWeight: 600,
        fontSize: "11px",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        ...variantStyles[variant],
      }}
    >
      {dot && (
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            flexShrink: 0,
            background: dotColors[variant],
          }}
        />
      )}
      {children}
    </span>
  );
}
