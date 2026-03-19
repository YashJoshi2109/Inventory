import { useEffect } from "react";
import { clsx } from "clsx";
import { Camera, CameraOff, FlipHorizontal } from "lucide-react";
import { useScanner } from "@/hooks/useScanner";
import { Button } from "@/components/ui/Button";
import type { Result } from "@zxing/library";

interface BarcodeScannerProps {
  onScan: (value: string) => void;
  onError?: (error: Error) => void;
  className?: string;
  autoStart?: boolean;
}

export function BarcodeScanner({ onScan, onError, className, autoStart = true }: BarcodeScannerProps) {
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
    <div className={clsx("relative overflow-hidden rounded-xl bg-black", className)}>
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Scan overlay */}
      {state === "scanning" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {/* Corner brackets */}
          <div className="relative w-56 h-56">
            {[
              "top-0 left-0 border-t-4 border-l-4 rounded-tl-lg",
              "top-0 right-0 border-t-4 border-r-4 rounded-tr-lg",
              "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg",
              "bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg",
            ].map((cls, i) => (
              <div key={i} className={clsx("absolute w-10 h-10 border-brand-400", cls)} />
            ))}
            {/* Animated scan line */}
            <div className="absolute inset-x-0 h-0.5 bg-brand-400/70 animate-scan-line" />
          </div>
        </div>
      )}

      {/* State overlays */}
      {state === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-card">
          <Camera size={40} className="text-slate-400" />
          <p className="text-slate-400 text-sm">Camera not started</p>
          <Button onClick={start} size="sm">Start Scanner</Button>
        </div>
      )}

      {state === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-card">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Starting camera…</p>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-card">
          <CameraOff size={40} className="text-red-400" />
          <p className="text-sm text-red-400 text-center px-4">{error ?? "Camera error"}</p>
          <Button onClick={start} variant="secondary" size="sm">Retry</Button>
        </div>
      )}

      {/* Controls */}
      {state === "scanning" && cameras.length > 1 && (
        <button
          onClick={toggleCamera}
          className="absolute top-3 right-3 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        >
          <FlipHorizontal size={18} />
        </button>
      )}
    </div>
  );
}
