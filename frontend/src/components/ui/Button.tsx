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

const variants: Record<Variant, string> = {
  primary:
    "text-white font-semibold shadow-glow-cyan-sm hover:shadow-glow-cyan transition-shadow",
  secondary:
    "text-slate-300 hover:text-white transition-colors",
  danger:
    "bg-red-600 hover:bg-red-500 text-white shadow-sm",
  ghost:
    "text-slate-400 hover:text-white transition-colors",
  success:
    "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm",
};

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "linear-gradient(135deg, #0891b2, #06b6d4)",
    border: "1px solid rgba(34,211,238,0.4)",
  },
  secondary: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  danger: {},
  ghost: { background: "transparent" },
  success: {},
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-6 py-3 text-base gap-2.5",
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
        "inline-flex items-center justify-center rounded-xl font-medium",
        "transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "active:scale-[0.97]",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
      style={{ ...variantStyles[variant], ...style }}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  ),
);

Button.displayName = "Button";
