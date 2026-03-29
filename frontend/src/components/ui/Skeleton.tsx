import { clsx } from "clsx";

import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  style?: CSSProperties;
}

export function Skeleton({ className, rounded = "lg", style }: SkeletonProps) {
  return (
    <div
      style={style}
      className={clsx(
        "animate-pulse bg-slate-800/70",
        {
          "rounded-sm": rounded === "sm",
          "rounded-md": rounded === "md",
          "rounded-lg": rounded === "lg",
          "rounded-xl": rounded === "xl",
          "rounded-2xl": rounded === "2xl",
          "rounded-full": rounded === "full",
        },
        className
      )}
    />
  );
}

/** A row of text-like skeleton lines */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? "60%" : "100%" } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/** Skeleton for a KPI stat card */
export function SkeletonKpiCard() {
  return (
    <div className="rounded-2xl p-5 bg-surface-card border border-surface-border/50 space-y-3 overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-2.5 w-20" rounded="full" />
          <Skeleton className="h-8 w-16" rounded="md" />
          <Skeleton className="h-2 w-12" rounded="full" />
        </div>
        <Skeleton className="w-11 h-11 shrink-0" rounded="xl" />
      </div>
    </div>
  );
}

/** Skeleton for a table row */
export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-3 py-3 px-4 border-b border-surface-border/40">
      <Skeleton className="w-8 h-8 shrink-0" rounded="xl" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      {Array.from({ length: cols - 2 }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-16 shrink-0" rounded="md" />
      ))}
    </div>
  );
}

/** Skeleton for a card with a header */
export function SkeletonCard({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-2xl bg-surface-card border border-surface-border/50 overflow-hidden">
      <div className="p-4 border-b border-surface-border/50">
        <Skeleton className="h-4 w-40" rounded="md" />
      </div>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonTableRow key={i} cols={4} />
        ))}
      </div>
    </div>
  );
}

/** Full-page auth bootstrap skeleton */
export function SkeletonApp() {
  return (
    <div className="min-h-dvh bg-surface flex">
      {/* Sidebar skeleton */}
      <div className="hidden lg:flex flex-col w-64 bg-surface-card border-r border-surface-border p-4 gap-3 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="w-9 h-9" rounded="xl" />
          <Skeleton className="h-4 w-32" rounded="md" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="w-5 h-5 shrink-0" rounded="md" />
            <Skeleton className="h-3 flex-1" rounded="md" />
          </div>
        ))}
      </div>
      {/* Main content skeleton */}
      <div className="flex-1 flex flex-col">
        <div className="h-14 bg-surface-card border-b border-surface-border flex items-center px-4 gap-3">
          <Skeleton className="h-5 w-40" rounded="md" />
          <div className="flex-1" />
          <Skeleton className="w-8 h-8" rounded="full" />
        </div>
        <div className="p-4 lg:p-6 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonKpiCard key={i} />
            ))}
          </div>
          <SkeletonCard rows={6} />
        </div>
      </div>
    </div>
  );
}
