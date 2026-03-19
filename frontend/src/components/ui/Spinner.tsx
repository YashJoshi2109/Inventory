import { clsx } from "clsx";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = { sm: "w-4 h-4", md: "w-6 h-6", lg: "w-10 h-10" };

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <span
      className={clsx(
        "inline-block rounded-full border-2 border-current border-t-transparent animate-spin",
        sizes[size],
        className
      )}
      aria-label="Loading"
    />
  );
}
