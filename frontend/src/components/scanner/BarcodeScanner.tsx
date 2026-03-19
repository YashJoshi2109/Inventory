import { useEffect } from "react";
import { clsx } from "clsx";
import { Camera, CameraOff, FlipHorizontal, Loader2 } from "lucide-react";
import { useScanner } from "@/hooks/useScanner";
import type { Result } from "@zxing/library";

interface BarcodeScannerProps {
  onScan: (value: string) => void;
  onError?: (error: Error) => void;
  className?: string;
  autoStart?: boolean;
  hint?: string;
}

export function BarcodeScanner({
  onScan,
  onError,
  className,
  autoStart = true,
  hint = "Point camera at QR code",
}: BarcodeScannerProps) {
  const { videoRef, state, error, cameras, selectedCamera, setSelectedCamera, start, stop } =
    useScanner({
      onScan: (value: string, _result: Result) => onScan(value),
      onError,
    });

  useEffect(() => {
    if (autoStart) start();
    return () => stop();
  }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCamera = () => {
    if (cameras.length <= 1) return;
    const current = cameras.findIndex((c) => c.deviceId === selectedCamera);
    const next = cameras[(current + 1) % cameras.length];
    setSelectedCamera(next.deviceId);
    stop();
    setTimeout(start, 300);
  };

  return (
    <div className={clsx("relative overflow-hidden rounded-2xl bg-black", className)}>
      {/* Camera feed */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Grid overlay on camera */}
      {state === "scanning" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(34,211,238,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.03) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
      )}

      {/* Dim edges vignette */}
      {state === "scanning" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 45%, rgba(3,7,18,0.7) 100%)",
          }}
        />
      )}

      {/* Scanning overlay — viewfinder */}
      {state === "scanning" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative" style={{ width: "220px", height: "220px" }}>
            {/* Corner brackets — top-left */}
            <span
              className="absolute top-0 left-0 border-t-[3px] border-l-[3px] border-brand-400 rounded-tl-lg animate-corner-glow"
              style={{ width: "28px", height: "28px" }}
            />
            {/* top-right */}
            <span
              className="absolute top-0 right-0 border-t-[3px] border-r-[3px] border-brand-400 rounded-tr-lg animate-corner-glow"
              style={{ width: "28px", height: "28px" }}
            />
            {/* bottom-left */}
            <span
              className="absolute bottom-0 left-0 border-b-[3px] border-l-[3px] border-brand-400 rounded-bl-lg animate-corner-glow"
              style={{ width: "28px", height: "28px" }}
            />
            {/* bottom-right */}
            <span
              className="absolute bottom-0 right-0 border-b-[3px] border-r-[3px] border-brand-400 rounded-br-lg animate-corner-glow"
              style={{ width: "28px", height: "28px" }}
            />

            {/* Subtle inner frame */}
            <div className="absolute inset-0 border border-white/5 rounded-lg" />

            {/* Animated scan line */}
            <div
              className="animate-scan-line"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.0) 15%, rgba(34,211,238,0.9) 50%, rgba(34,211,238,0.0) 85%, transparent 100%)",
                boxShadow: "0 0 10px rgba(34,211,238,0.6), 0 0 20px rgba(34,211,238,0.3)",
              }}
            />
          </div>
        </div>
      )}

      {/* Bottom glass hint panel */}
      {state === "scanning" && (
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
          <div
            className="mx-4 mb-3 px-4 py-2.5 rounded-xl text-center"
            style={{
              background: "rgba(3,7,18,0.75)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(34,211,238,0.2)",
            }}
          >
            <p className="text-xs text-brand-300 font-medium tracking-wide">{hint}</p>
          </div>
        </div>
      )}

      {/* Flip camera button */}
      {state === "scanning" && cameras.length > 1 && (
        <button
          onClick={toggleCamera}
          className="absolute top-3 right-3 p-2 rounded-xl pointer-events-auto transition-all"
          style={{
            background: "rgba(3,7,18,0.7)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(34,211,238,0.2)",
          }}
        >
          <FlipHorizontal size={16} className="text-brand-400" />
        </button>
      )}

      {/* State overlays */}
      {state === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-card">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center animate-glow-pulse"
            style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)" }}
          >
            <Camera size={28} className="text-brand-400" />
          </div>
          <p className="text-slate-400 text-sm">Camera not started</p>
          <button
            onClick={start}
            className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-all"
            style={{
              background: "linear-gradient(135deg, #0891b2, #06b6d4)",
              boxShadow: "0 0 20px rgba(34,211,238,0.3)",
            }}
          >
            Start Scanner
          </button>
        </div>
      )}

      {state === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-card">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={28} className="text-brand-400 animate-spin" />
            <p className="text-slate-400 text-sm">Initialising camera…</p>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-card p-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}
          >
            <CameraOff size={28} className="text-red-400" />
          </div>
          <p className="text-sm text-red-400 text-center">{error ?? "Camera error"}</p>
          <button
            onClick={start}
            className="px-5 py-2 rounded-xl text-sm font-medium border border-surface-border-strong text-slate-300 hover:text-white hover:border-brand-500/40 transition-all"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
