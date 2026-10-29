/**
 * useScanner — QR/barcode decode engine (camera-based).
 *
 * Wraps ZXing's BrowserMultiFormatReader with:
 * - Multi-format hints (QR, CODE_128, EAN-13/8, UPC-A/E) so only expected
 *   symbologies are attempted.
 * - Back/rear camera preference (matches label /back|rear|environment/) when
 *   `preferBackCamera` is set, falling back to the first available device.
 * - Cooldown de-dupe: the same decoded value is ignored for `cooldownMs`
 *   (default 1500ms) so one physical scan does not fire repeatedly.
 * - Exception suppression: NotFoundException is normal (no code in frame) and
 *   ChecksumException/FormatException are treated as transient and ignored;
 *   only other errors surface via `onError`.
 */
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

  // One "generation" per start(). A stop() or a newer start() bumps it, so the
  // controls from an older, still-resolving decodeFromVideoDevice() are shut
  // down the moment they arrive instead of leaking a second camera stream and
  // decode loop. React StrictMode mounts twice; without this the first stream
  // kept running under the second one.
  const generationRef = useRef(0);

  const start = useCallback(async () => {
    if (!videoRef.current) return;
    if (controlsRef.current) return;                 // already scanning
    const generation = ++generationRef.current;
    setState("starting");
    setError(null);

    try {
      if (!readerRef.current) {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.CODE_128,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ]);
        readerRef.current = new BrowserMultiFormatReader(hints, {
          // 100 ms meant a full-frame multi-format decode ten times a second on
          // the main thread. On phones that pinned the CPU and grew memory until
          // the tab was reloaded. Four attempts a second still feels instant.
          delayBetweenScanAttempts: 250,
          delayBetweenScanSuccess: cooldownMs,
        });
      }

      const onDecode = (result: Result | undefined, err: Error | undefined) => {
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
      };

      // Ask for a modest frame: decoding works on luminance and does not need
      // 4K, and every frame is copied into a canvas for ZXing.
      const constraintsFor = (deviceId: string | null): MediaStreamConstraints => ({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      let controls: IScannerControls;
      try {
        controls = await readerRef.current.decodeFromConstraints(
          constraintsFor(selectedCamera), videoRef.current, onDecode,
        );
      } catch (e: unknown) {
        // enumerateDevices() still lists a camera that has gone away (an iPhone
        // Continuity Camera, a virtual camera, a stale id from before permission
        // was granted). "Requested device not found" is the result. Fall back to
        // any camera rather than dead-ending the page.
        const name = e instanceof Error ? e.name : "";
        const retryable = selectedCamera && (name === "OverconstrainedError" || name === "NotFoundError");
        if (!retryable) throw e;
        setSelectedCamera(null);
        controls = await readerRef.current.decodeFromConstraints(
          constraintsFor(null), videoRef.current, onDecode,
        );
      }

      if (generation !== generationRef.current) {
        // stop() or another start() happened while the camera was opening.
        controls.stop();
        return;
      }
      controlsRef.current = controls;
      setState("scanning");
    } catch (e: unknown) {
      if (generation !== generationRef.current) return;   // superseded; not an error
      const msg = e instanceof Error ? e.message : "Camera access denied";
      setError(msg);
      setState("error");
      onError?.(new Error(msg));
    }
  }, [selectedCamera, onError, cooldownMs]);

  const stop = useCallback(() => {
    generationRef.current++;
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
      generationRef.current++;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [listCameras]);

  // A backgrounded tab keeps the camera and the decode loop alive otherwise,
  // which is where the "scanner went off / page reloaded" reports came from on
  // phones. Release the camera when hidden and pick it back up on return, but
  // only if it was this handler that stopped it: a scanner the user stopped
  // stays stopped.
  const startRef = useRef(start);
  startRef.current = start;
  const pausedByVisibilityRef = useRef(false);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (!controlsRef.current) return;
        generationRef.current++;
        controlsRef.current.stop();
        controlsRef.current = null;
        pausedByVisibilityRef.current = true;
        setState("stopped");
      } else if (pausedByVisibilityRef.current) {
        pausedByVisibilityRef.current = false;
        void startRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

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
