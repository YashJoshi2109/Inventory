import { type ReactNode } from "react";
import { clsx } from "clsx";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={clsx("flex flex-col items-center justify-center py-16 text-center", className)}>
      {icon && <div className="mb-4" style={{ color: "var(--text-muted)" }}>{icon}</div>}
      <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
      {description && <p className="mt-1 text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
