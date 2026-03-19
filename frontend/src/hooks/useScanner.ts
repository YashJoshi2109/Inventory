import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import type { Result } from "@zxing/library";

export type ScannerState = "idle" | "starting" | "scanning" | "error" | "stopped";

interface UseScannerOptions {
  onScan: (value: string, result: Result) => void;
  onError?: (error: Error) => void;
  preferBackCamera?: boolean;
}

export function useScanner({ onScan, onError, preferBackCamera = true }: UseScannerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [state, setState] = useState<ScannerState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);

  const listCameras = useCallback(async () => {
    try {
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      setCameras(devices);
      if (devices.length > 0) {
        // Prefer back camera on mobile
        const back = preferBackCamera
          ? devices.find((d) => /back|rear|environment/i.test(d.label))
          : null;
        setSelectedCamera((back ?? devices[0]).deviceId);
      }
    } catch (e) {
      console.error("Camera list error", e);
    }
  }, [preferBackCamera]);

  const start = useCallback(async () => {
    if (!videoRef.current || state === "scanning") return;
    setState("starting");
    setError(null);

    try {
      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
      }
      const deviceId = selectedCamera ?? undefined;

      controlsRef.current = await readerRef.current.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result, err) => {
          if (result) {
            onScan(result.getText(), result);
          }
          if (err && !(err.name === "NotFoundException")) {
            const scanError = new Error(err.message);
            setError(err.message);
            onError?.(scanError);
          }
        }
      );
      setState("scanning");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Camera access denied";
      setError(msg);
      setState("error");
      onError?.(new Error(msg));
    }
  }, [state, selectedCamera, onScan, onError]);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setState("stopped");
  }, []);

  useEffect(() => {
    listCameras();
    return () => {
      controlsRef.current?.stop();
    };
  }, [listCameras]);

  return {
    videoRef,
    state,
    error,
    cameras,
    selectedCamera,
    setSelectedCamera,
    start,
    stop,
  };
}
