import { forwardRef, type InputHTMLAttributes } from "react";
import { clsx } from "clsx";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftIcon, rightIcon, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-slate-300">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={clsx(
              "w-full rounded-xl text-slate-100 placeholder-slate-600",
              "px-3 py-2.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/40",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "transition-all duration-150",
              error
                ? "border-red-500/60 focus:ring-red-500/50"
                : "hover:border-white/15",
              leftIcon && "pl-10",
              rightIcon && "pr-10",
              className,
            )}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: error ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(255,255,255,0.09)",
            }}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              {rightIcon}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
