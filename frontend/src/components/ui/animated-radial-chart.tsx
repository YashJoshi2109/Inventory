import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect } from "react";

interface AnimatedRadialChartProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  showLabels?: boolean;
  duration?: number;
  className?: string;
}

export function AnimatedRadialChart({
  value,
  size = 180,
  strokeWidth: customStroke,
  color = "#34d399",
  trackColor,
  showLabels = true,
  duration = 1.4,
  className,
}: AnimatedRadialChartProps) {
  const sw        = customStroke ?? Math.max(10, size * 0.055);
  const radius    = size * 0.36;
  const center    = size / 2;
  const circ      = Math.PI * radius;
  const innerR    = radius - sw / 2;

  const anim   = useMotionValue(0);
  const offset = useTransform(anim, [0, 100], [circ, 0]);
  const angle  = useTransform(anim, [0, 100], [-Math.PI, 0]);

  useEffect(() => {
    const ctrl = animate(anim, Math.max(0, Math.min(100, value)), {
      duration,
      ease: "easeOut",
    });
    return ctrl.stop;
  }, [value, anim, duration]);

  const fs    = Math.max(14, size * 0.1);
  const lfs   = Math.max(8, size * 0.038);
  const track = trackColor ?? "rgba(100,116,139,0.18)";

  return (
    <div
      className={className}
      style={{ width: size, height: size * 0.62, position: "relative" }}
    >
      <svg
        width={size}
        height={size * 0.62}
        viewBox={`0 0 ${size} ${size * 0.62}`}
        style={{ overflow: "visible" }}
      >
        {/* Track */}
        <path
          d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
          fill="none"
          stroke={track}
          strokeWidth={sw}
          strokeLinecap="butt"
        />

        {/* Progress */}
        <motion.path
          d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="butt"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
        />

        {/* End dot */}
        <motion.circle
          cx={useTransform(angle, (a) => center + Math.cos(a) * innerR)}
          cy={useTransform(angle, (a) => center + Math.sin(a) * innerR)}
          r={sw / 2 + 1.5}
          fill={color}
          style={{ filter: `drop-shadow(0 0 5px ${color}bb)` }}
        />
      </svg>

      {/* Center value */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <motion.div
          style={{
            fontSize: `${fs}px`,
            fontWeight: 900,
            marginTop: size * 0.08,
            color,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, delay: duration * 0.65 }}
        >
          <motion.span>
            {useTransform(anim, (v) => Math.round(v))}
          </motion.span>
          %
        </motion.div>
      </div>

      {showLabels && (
        <>
          <div
            style={{
              position: "absolute",
              fontSize: `${lfs}px`,
              fontWeight: 600,
              color: "var(--text-muted)",
              left: center - radius - 2,
              top: center * 1.22,
            }}
          >
            0%
          </div>
          <div
            style={{
              position: "absolute",
              fontSize: `${lfs}px`,
              fontWeight: 600,
              color: "var(--text-muted)",
              left: center + radius - 20,
              top: center * 1.22,
            }}
          >
            100%
          </div>
        </>
      )}
    </div>
  );
}
