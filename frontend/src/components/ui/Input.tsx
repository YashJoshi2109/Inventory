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
  ({ label, error, hint, leftIcon, rightIcon, className, id, style, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            style={{
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "'Outfit', sans-serif",
              color: "var(--text-secondary)",
            }}
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            >
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={clsx(
              "w-full transition-all duration-150",
              "focus:outline-none",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              leftIcon && "pl-10",
              rightIcon && "pr-10",
              className,
            )}
            style={{
              background: "var(--bg-input)",
              border: error
                ? "1px solid var(--accent-danger)"
                : "1px solid var(--border-subtle)",
              borderRadius: "12px",
              color: "var(--text-primary)",
              fontFamily: "'Outfit', sans-serif",
              fontSize: "14px",
              padding: leftIcon ? "10px 12px 10px 40px" : rightIcon ? "10px 40px 10px 12px" : "10px 12px",
              boxShadow: "none",
              // Focus styles applied via inline style trick — handled by CSS classes below
              ...style,
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = error
                ? "var(--accent-danger)"
                : "var(--accent)";
              e.currentTarget.style.boxShadow = error
                ? "0 0 0 3px rgba(220,38,38,0.12)"
                : "0 0 0 3px rgba(var(--accent-rgb, 37,99,235), 0.12)";
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = error
                ? "var(--accent-danger)"
                : "var(--border-subtle)";
              e.currentTarget.style.boxShadow = "none";
              props.onBlur?.(e);
            }}
            {...props}
          />
          {rightIcon && (
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            >
              {rightIcon}
            </span>
          )}
        </div>
        {error && (
          <p
            style={{
              fontSize: "12px",
              color: "var(--accent-danger)",
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            {error}
          </p>
        )}
        {hint && !error && (
          <p
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              fontFamily: "'Outfit', sans-serif",
            }}
          >
            {hint}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
