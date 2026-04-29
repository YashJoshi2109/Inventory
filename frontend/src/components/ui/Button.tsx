import { forwardRef, type ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "linear-gradient(135deg, var(--accent), var(--accent-hover))",
    color: "#ffffff",
    border: "none",
    boxShadow: "0 4px 14px rgba(var(--accent-rgb, 37,99,235), 0.35)",
  },
  secondary: {
    background: "var(--bg-card)",
    border: "1px solid var(--border-card)",
    color: "var(--text-secondary)",
  },
  danger: {
    background: "rgba(var(--accent-danger-rgb, 220,38,38), 0.12)",
    border: "1px solid var(--accent-danger)",
    color: "var(--accent-danger)",
  },
  ghost: {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
  },
  success: {
    background: "rgba(var(--accent-success-rgb, 5,150,105), 0.12)",
    border: "1px solid var(--accent-success)",
    color: "var(--accent-success)",
  },
};

const variantHoverClass: Record<Variant, string> = {
  primary:
    "hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(var(--accent-rgb,37,99,235),0.5)]",
  secondary: "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
  danger:
    "hover:bg-[rgba(var(--accent-danger-rgb,220,38,38),0.22)]",
  ghost: "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
  success:
    "hover:bg-[rgba(var(--accent-success-rgb,5,150,105),0.22)]",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-6 py-2.5 text-base gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      className,
      disabled,
      children,
      style,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center font-semibold",
        "transition-all duration-150 focus:outline-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2",
        "focus-visible:ring-offset-[var(--bg-card)]",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none",
        "active:scale-[0.97]",
        variantHoverClass[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
      style={{
        borderRadius: "12px",
        fontFamily: "'Outfit', sans-serif",
        fontWeight: 600,
        ...variantStyles[variant],
        ...style,
      }}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  ),
);

Button.displayName = "Button";
