import { clsx } from "clsx";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const dimensions: Record<NonNullable<SpinnerProps["size"]>, { wh: number; stroke: number }> = {
  sm: { wh: 16, stroke: 2 },
  md: { wh: 24, stroke: 2.5 },
  lg: { wh: 40, stroke: 3 },
};

const spinKeyframes = `
@keyframes crystal-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

let injected = false;
function injectKeyframes() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = spinKeyframes;
  document.head.appendChild(style);
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  injectKeyframes();
  const { wh, stroke } = dimensions[size];
  const r = (wh - stroke * 2) / 2;
  const cx = wh / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <span
      role="status"
      aria-label="Loading"
      className={clsx("inline-flex items-center justify-center flex-shrink-0", className)}
      style={{ width: wh, height: wh }}
    >
      <svg
        width={wh}
        height={wh}
        viewBox={`0 0 ${wh} ${wh}`}
        fill="none"
        style={{
          animation: "crystal-spin 0.75s linear infinite",
        }}
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          stroke="rgba(var(--accent-rgb, 37,99,235), 0.15)"
          strokeWidth={stroke}
        />
        {/* Arc */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * 0.75}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </svg>
    </span>
  );
}
