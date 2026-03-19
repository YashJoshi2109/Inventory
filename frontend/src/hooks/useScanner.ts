import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import type { Result } from "@zxing/library";

export type ScannerState = "idle" | "starting" | "scanning" | "error" | "stopped";

interface UseScannerOptions {
  onScan: (value: string, result: Result) => void;
  onError?: (error: Error) => void;
  preferBackCamera?: boolean;
  cooldownMs?: number;
}

const SCAN_COOLDOWN_MS = 1500;

export function useScanner({ onScan, onError, preferBackCamera = true, cooldownMs = SCAN_COOLDOWN_MS }: UseScannerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastScanRef = useRef<{ value: string; time: number }>({ value: "", time: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [state, setState] = useState<ScannerState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);

  const listCameras = useCallback(async () => {
    try {
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      setCameras(devices);
      if (devices.length > 0) {
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
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.CODE_128,
          BarcodeFormat.EAN_13,
          BarcodeFormat.DATA_MATRIX,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        readerRef.current = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 250,
        });
      }
      const deviceId = selectedCamera ?? undefined;

      controlsRef.current = await readerRef.current.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result, err) => {
          if (result) {
            const value = result.getText();
            const now = Date.now();
            const last = lastScanRef.current;
            if (value === last.value && now - last.time < cooldownMs) {
              return;
            }
            lastScanRef.current = { value, time: now };
            onScanRef.current(value, result);
          }
          if (err && err.name !== "NotFoundException") {
            // Ignore ChecksumException and FormatException — they're transient
            if (err.name === "ChecksumException" || err.name === "FormatException") return;
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
  }, [state, selectedCamera, onError, cooldownMs]);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setState("stopped");
  }, []);

  const resetCooldown = useCallback(() => {
    lastScanRef.current = { value: "", time: 0 };
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
    resetCooldown,
  };
}
