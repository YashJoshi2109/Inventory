import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { clsx } from "clsx";
import {
  ArrowLeft,
  AlertTriangle,
  BarChart3,
  Camera,
  CameraOff,
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  FlipHorizontal,
  Hash,
  Info,
  Loader2,
  Package,
  PackagePlus,
  PenLine,
  Plus,
  RefreshCw,
  Scan,
  Sparkles,
  Tag,
  Upload,
  X,
  Zap,
} from "lucide-react";
import type { SmartScanPrefill } from "@/pages/Scan";
import { useAuthStore } from "@/store/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedItem {
  name: string;
  category: string;
  brand: string;
  model: string;
  quantity: number;
  confidence: number;
  notes: string;
}

interface VisionAnalysisResult {
  detected_items: DetectedItem[];
  ocr_text: string;
  item_count: number;
  damage_detected: boolean;
  damage_notes: string;
  metadata_suggestions: {
    category: string;
    tags: string[];
    brand: string;
    model: string;
    usage_type: string;
  };
  shelf_audit: {
    total_visible: number;
    organized: boolean;
    issues: string[];
  };
  raw_analysis: string;
  analysis_type: string;
}

interface VisionStatus {
  primary_model: string;
  fallback_models: string[];
  last_model_used: string | null;
  quota_limited: boolean;
  last_error: string | null;
  checked_at: string | null;
  last_success_at: string | null;
  user_scans_remaining: number;
  user_scans_limit: number;
  user_scans_remaining_day: number;
  user_scans_limit_day: number;
  user_retry_after_seconds: number;
}

interface QuotaError {
  code: string;
  message: string;
  retry_after_seconds: number;
  scans_remaining: number;
  scans_limit: number;
}

type AnalysisType = "full" | "classify" | "ocr" | "count" | "audit";
type PageMode = "camera" | "preview" | "analyzing" | "results" | "quota_exceeded";

// ─── API Helper ───────────────────────────────────────────────────────────────

/** Resize and compress a Blob to ≤1280px JPEG at 0.78 quality before upload. */
async function compressForUpload(blob: Blob): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(blob); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (compressed) => resolve(compressed ?? blob),
        "image/jpeg",
        0.78
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

async function analyzeImage(
  image: Blob,
  type: string,
  context: string
): Promise<VisionAnalysisResult> {
  const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
  const token = useAuthStore.getState().accessToken;
  const compressed = await compressForUpload(image);
  const form = new FormData();
  form.append("image", compressed, "capture.jpg");
  form.append("analysis_type", type);
  form.append("context", context);
  const response = await fetch(`${BASE_URL}/ai/vision/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    let detail: string | QuotaError = "";
    try {
      const payload = await response.json() as { detail?: string | QuotaError };
      detail = payload.detail ?? "";
    } catch { /* ignore */ }

    if (response.status === 429 && typeof detail === "object" && detail.code) {
      const err = new Error(detail.message || "Quota exceeded");
      (err as Error & { quotaError: QuotaError }).quotaError = detail;
      throw err;
    }
    // Provider-level quota (no structured detail)
    if (response.status === 429) {
      const err = new Error(typeof detail === "string" ? detail : "Vision quota exceeded across all providers.");
      (err as Error & { isProviderQuota: boolean }).isProviderQuota = true;
      throw err;
    }
    throw new Error((typeof detail === "string" ? detail : detail.message) || `Analysis failed: ${response.status}`);
  }
  return response.json() as Promise<VisionAnalysisResult>;
}

// ─── Analysis Type Config ─────────────────────────────────────────────────────

const ANALYSIS_TYPES: Array<{
  id: AnalysisType;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  desc: string;
}> = [
  { id: "full", label: "Full Scan", icon: Sparkles, desc: "Complete analysis" },
  { id: "classify", label: "Classify", icon: Tag, desc: "Identify item type" },
  { id: "ocr", label: "OCR", icon: FileText, desc: "Extract text" },
  { id: "count", label: "Count", icon: Hash, desc: "Count items" },
  { id: "audit", label: "Audit", icon: BarChart3, desc: "Shelf audit" },
];

// ─── Confidence Bar ───────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "#22d3ee" : pct >= 50 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="flex-1 h-1 rounded-full"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <div
          className="h-1 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[10px] font-mono shrink-0" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

// ─── SKU suggestion ───────────────────────────────────────────────────────────

function suggestSku(name: string, brand: string, model: string): string {
  const prefix = brand
    ? brand.replace(/\s+/g, "").slice(0, 3).toUpperCase()
    : name.split(" ").map((w) => w[0] ?? "").join("").slice(0, 3).toUpperCase();
  const mid = model
    ? model.replace(/\s+/g, "").slice(0, 4).toUpperCase()
    : name.split(" ").slice(-1)[0]?.slice(0, 4).toUpperCase() ?? "";
  const suffix = String(Math.floor(Math.random() * 900) + 100);
  return [prefix, mid, suffix].filter(Boolean).join("-");
}

// ─── Review Sheet ─────────────────────────────────────────────────────────────

function ReviewSheet({
  item,
  imagePreview,
  onConfirm,
  onCancel,
}: {
  item: DetectedItem;
  imagePreview: string | null;
  onConfirm: (prefill: SmartScanPrefill) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SmartScanPrefill>(() => ({
    name: item.name || "",
    sku: suggestSku(item.name, item.brand, item.model),
    category: item.category || "",
    unit: "EA",
    quantity: item.quantity || 1,
    description: [item.brand && `Brand: ${item.brand}`, item.model && `Model: ${item.model}`, item.notes]
      .filter(Boolean).join(" · "),
    supplier: item.brand || "",
  }));
  const confidence = Math.round(item.confidence * 100);
  const confColor = confidence >= 80 ? "#34d399" : confidence >= 50 ? "#fbbf24" : "#f87171";

  const field = (label: string, key: keyof SmartScanPrefill, opts?: { type?: string; required?: boolean }) => (
    <div>
      <label className="block text-[11px] text-slate-400 mb-1 font-medium">
        {label}{opts?.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={opts?.type ?? "text"}
        value={String(form[key])}
        onChange={(e) => setForm((f) => ({ ...f, [key]: opts?.type === "number" ? Number(e.target.value) : e.target.value }))}
        className="w-full rounded-xl px-3 py-2 text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-cyan-400/50 transition-colors"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "rgba(3,7,18,0.85)", backdropFilter: "blur(12px)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <button onClick={onCancel}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <X size={15} />
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold text-white">Verify before adding</p>
          <p className="text-[11px] text-slate-500">Review AI-detected details — edit anything before sending to inventory</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold"
          style={{ background: `${confColor}18`, border: `1px solid ${confColor}40`, color: confColor }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: confColor }} />
          {confidence}% confidence
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Image + AI badge */}
        {imagePreview && (
          <div className="relative w-full h-36 rounded-2xl overflow-hidden"
            style={{ border: "1px solid rgba(34,211,238,0.15)" }}>
            <img src={imagePreview} alt="Scanned" className="w-full h-full object-cover" />
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold"
              style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.25)" }}>
              <Sparkles size={11} />
              AI Detected
            </div>
          </div>
        )}

        {/* Warning if low confidence */}
        {confidence < 60 && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
            style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)" }}>
            <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80">
              Low confidence detection — please verify all fields carefully before adding to inventory.
            </p>
          </div>
        )}

        {/* Editable form */}
        <div className="space-y-3 pb-2">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <PenLine size={11} /> Edit details
          </p>
          {field("Item Name", "name", { required: true })}
          <div className="grid grid-cols-2 gap-2">
            {field("SKU", "sku", { required: true })}
            {field("Unit", "unit")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {field("Category", "category")}
            {field("Initial Qty", "quantity", { type: "number" })}
          </div>
          {field("Supplier / Brand", "supplier")}
          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-medium">Description / Notes</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-xl px-3 py-2 text-sm text-white bg-white/5 border border-white/10 focus:outline-none focus:border-cyan-400/50 transition-colors resize-none"
            />
          </div>
        </div>

        {/* Info note */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
          style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.12)" }}>
          <Info size={13} className="text-cyan-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-400">
            After confirming, you'll scan a <span className="text-cyan-300 font-semibold">shelf QR</span> to place this item. The form will be pre-filled.
          </p>
        </div>
      </div>

      {/* Footer buttons */}
      <div className="px-4 pt-3 pb-6 flex gap-3 shrink-0"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button onClick={onCancel}
          className="flex-1 py-3.5 rounded-2xl text-sm font-semibold text-slate-400 hover:text-white transition-colors"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          Cancel
        </button>
        <button
          onClick={() => {
            if (!form.name.trim() || !form.sku.trim()) {
              toast.error("Name and SKU are required");
              return;
            }
            onConfirm(form);
          }}
          className="flex-2 flex-[2] flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg,#7c3aed,#a855f7)",
            boxShadow: "0 4px 24px rgba(139,92,246,0.4)",
            color: "white",
          }}>
          <PackagePlus size={16} />
          Confirm — Go to Scan
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SmartScan() {
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

  const [mode, setMode] = useState<PageMode>("camera");
  const [analysisType, setAnalysisType] = useState<AnalysisType>("full");

  const [capturedImage, setCapturedImage] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);

  const [results, setResults] = useState<VisionAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameraAvailable, setCameraAvailable] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [visionStatus, setVisionStatus] = useState<VisionStatus | null>(null);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [showRawAnalysis, setShowRawAnalysis] = useState(false);
  const [reviewItem, setReviewItem] = useState<DetectedItem | null>(null);
  const [quotaError, setQuotaError] = useState<QuotaError | null>(null);
  const [retryCountdown, setRetryCountdown] = useState<number>(0);

  useEffect(() => {
    if (!accessToken) return;
    let alive = true;

    const loadVisionStatus = async () => {
      try {
        const res = await fetch(`${BASE_URL}/ai/vision/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const payload = await res.json() as VisionStatus;
        if (alive) setVisionStatus(payload);
      } catch {
        // ignore polling errors
      }
    };

    void loadVisionStatus();
    const timer = setInterval(() => { void loadVisionStatus(); }, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [BASE_URL, accessToken]);

  // ── Camera lifecycle ──────────────────────────────────────────────────────

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (facing: "environment" | "user") => {
      stopStream();
      setCameraError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraAvailable(false);
        setCameraError("Camera API is not available in this browser/context.");
        return;
      }

      try {
        // First try preferred constraints.
        const preferred = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        streamRef.current = preferred;
      } catch {
        try {
          // Fallback for browsers/devices that reject strict facing constraints.
          const fallback = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          streamRef.current = fallback;
        } catch (err) {
          const e = err as DOMException | Error;
          const name = e?.name ?? "";
          if (name === "NotAllowedError" || name === "SecurityError") {
            setCameraError("Camera permission denied. Please allow camera access in browser settings.");
          } else if (name === "NotFoundError" || name === "OverconstrainedError") {
            setCameraError("No compatible camera found on this device.");
          } else {
            setCameraError("Could not start camera. Try refresh or use image upload.");
          }
          setCameraAvailable(false);
          return;
        }
      }

      try {
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          await videoRef.current.play();
        }
        setCameraAvailable(true);
      } catch {
        setCameraAvailable(false);
        setCameraError("Camera stream started but video playback failed.");
      }
    },
    [stopStream]
  );

  useEffect(() => {
    if (mode === "camera") {
      void startCamera(cameraFacing);
    } else {
      stopStream();
    }
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cameraFacing]);

  // ── Quota countdown timer ─────────────────────────────────────────────────

  useEffect(() => {
    if (retryCountdown <= 0) return;
    const id = setInterval(() => {
      setRetryCountdown((c) => {
        if (c <= 1) {
          clearInterval(id);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [retryCountdown]);

  // ── Capture from video ────────────────────────────────────────────────────

  const captureFromCamera = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Cap at 1280px on the longest side to keep upload small
    const MAX = 1280;
    let w = video.videoWidth || 1280;
    let h = video.videoHeight || 720;
    if (w > MAX || h > MAX) {
      const ratio = Math.min(MAX / w, MAX / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error("Failed to capture image");
          return;
        }
        const url = URL.createObjectURL(blob);
        setCapturedImage(blob);
        setCapturedPreview(url);
        setMode("preview");
      },
      "image/jpeg",
      0.80
    );
  }, []);

  // ── File pick ─────────────────────────────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    const url = URL.createObjectURL(file);
    setCapturedImage(file);
    setCapturedPreview(url);
    setMode("preview");
  }, [capturedPreview]);

  // ── Analyze ───────────────────────────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    if (!capturedImage) return;
    setMode("analyzing");
    setError(null);
    setResults(null);
    setQuotaError(null);

    try {
      const result = await analyzeImage(capturedImage, analysisType, "");
      setResults(result);
      setMode("results");
    } catch (err) {
      const typedErr = err as Error & { quotaError?: QuotaError; isProviderQuota?: boolean };

      if (typedErr.quotaError) {
        // Per-user quota hit
        setQuotaError(typedErr.quotaError);
        setRetryCountdown(typedErr.quotaError.retry_after_seconds);
        setMode("quota_exceeded");
      } else if (typedErr.isProviderQuota) {
        // Provider-level quota exhausted
        setQuotaError({
          code: "PROVIDER_QUOTA",
          message: "All AI vision providers are out of quota. Please try again later or add items manually.",
          retry_after_seconds: 3600,
          scans_remaining: 0,
          scans_limit: 0,
        });
        setRetryCountdown(3600);
        setMode("quota_exceeded");
      } else {
        const msg = typedErr.message || "Analysis failed";
        setError(msg);
        toast.error(msg);
        setMode("preview");
      }
    }
  }, [capturedImage, analysisType]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const resetToCamera = useCallback(() => {
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedImage(null);
    setCapturedPreview(null);
    setResults(null);
    setError(null);
    setQuotaError(null);
    setRetryCountdown(0);
    setShowRawAnalysis(false);
    setMode("camera");
  }, [capturedPreview]);

  // ── Open review sheet for human verification ──────────────────────────────

  const addItemToInventory = useCallback((item: DetectedItem) => {
    setReviewItem(item);
  }, []);

  const confirmAndNavigate = useCallback((prefill: SmartScanPrefill) => {
    setReviewItem(null);
    navigate("/scan", { state: { prefill } });
  }, [navigate]);

  // ── Flip camera ───────────────────────────────────────────────────────────

  const flipCamera = useCallback(() => {
    setCameraFacing((f) => (f === "environment" ? "user" : "environment"));
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col min-h-dvh pb-24 lg:pb-6"
      style={{ background: "#030712", color: "#e2e8f0" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(34,211,238,0.1)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Back</span>
        </button>

        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg,#0891b2,#22d3ee)" }}
          >
            <Scan size={14} className="text-white" />
          </div>
          <h1 className="text-base font-bold text-white">Smart Scan</h1>
        </div>

        <div className="flex items-center gap-2">
          {visionStatus && (() => {
            const remaining = visionStatus.user_scans_remaining ?? 0;
            const limit = visionStatus.user_scans_limit ?? 15;
            const pct = limit > 0 ? remaining / limit : 1;
            const isLow = pct < 0.34;
            const isEmpty = remaining === 0;
            const dotColor = isEmpty ? "#f87171" : isLow ? "#fbbf24" : "#34d399";
            return (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium"
                style={{
                  background: isEmpty ? "rgba(248,113,113,0.1)" : isLow ? "rgba(251,191,36,0.1)" : "rgba(52,211,153,0.1)",
                  border: `1px solid ${dotColor}45`,
                  color: dotColor,
                }}
                title={`${remaining}/${limit} scans remaining this hour · ${visionStatus.user_scans_remaining_day} today · Model: ${visionStatus.last_model_used ?? visionStatus.primary_model}`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                {isEmpty ? "Quota full" : `${remaining}/${limit} scans`}
              </div>
            );
          })()}
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-colors"
            style={{
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.03)",
            }}
            onClick={() =>
              toast("Point your camera at any item, shelf, or label to analyze it with AI.", {
                duration: 4500,
                icon: "💡",
              })
            }
          >
            <Info size={13} />
            Help
          </button>
        </div>
      </header>

      {/* ── Analysis Type Selector ───────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {ANALYSIS_TYPES.map(({ id, label, icon: Icon }) => {
            const active = analysisType === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setAnalysisType(id)}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all duration-150",
                  active ? "text-[#030712]" : "text-slate-400 hover:text-slate-200"
                )}
                style={
                  active
                    ? {
                        background: "linear-gradient(135deg,#0891b2,#22d3ee)",
                        boxShadow: "0 0 12px rgba(34,211,238,0.35)",
                      }
                    : {
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }
                }
              >
                <Icon size={13} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main content area ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 px-4 gap-4">

        {/* Camera view */}
        {mode === "camera" && (
          <div className="flex flex-col gap-3 flex-1">
            <div
              className="relative flex-1 rounded-3xl overflow-hidden"
              style={{
                border: "1px solid rgba(34,211,238,0.2)",
                minHeight: 260,
                background: "#0a0f1a",
                boxShadow: "0 0 40px rgba(34,211,238,0.07)",
              }}
            >
              {cameraAvailable ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="absolute inset-0 w-full h-full object-cover"
                  />

                  {/* Viewfinder overlay */}
                  <div className="absolute inset-0 pointer-events-none">
                    <div
                      className="absolute inset-8 rounded-2xl"
                      style={{ border: "1px solid rgba(34,211,238,0.3)" }}
                    />
                    {/* Corner accents */}
                    {[
                      { cls: "top-8 left-8", bt: true, bl: true, r: "tl" },
                      { cls: "top-8 right-8", bt: true, br: true, r: "tr" },
                      { cls: "bottom-8 left-8", bb: true, bl: true, r: "bl" },
                      { cls: "bottom-8 right-8", bb: true, br: true, r: "br" },
                    ].map(({ cls, bt, bb, bl, br, r }, i) => (
                      <div
                        key={i}
                        className={`absolute w-5 h-5 ${cls}`}
                        style={{
                          borderTop: bt ? "2px solid #22d3ee" : undefined,
                          borderBottom: bb ? "2px solid #22d3ee" : undefined,
                          borderLeft: bl ? "2px solid #22d3ee" : undefined,
                          borderRight: br ? "2px solid #22d3ee" : undefined,
                          borderTopLeftRadius: r === "tl" ? 6 : undefined,
                          borderTopRightRadius: r === "tr" ? 6 : undefined,
                          borderBottomLeftRadius: r === "bl" ? 6 : undefined,
                          borderBottomRightRadius: r === "br" ? 6 : undefined,
                        }}
                      />
                    ))}
                  </div>

                  {/* Flip camera */}
                  <button
                    type="button"
                    onClick={flipCamera}
                    className="absolute top-3 right-3 w-9 h-9 rounded-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                    style={{
                      background: "rgba(0,0,0,0.5)",
                      backdropFilter: "blur(8px)",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    <FlipHorizontal size={16} className="text-white" />
                  </button>

                  {/* Current analysis type badge */}
                  <div
                    className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold"
                    style={{
                      background: "rgba(0,0,0,0.6)",
                      backdropFilter: "blur(8px)",
                      color: "#22d3ee",
                      border: "1px solid rgba(34,211,238,0.25)",
                    }}
                  >
                    {(() => {
                      const t = ANALYSIS_TYPES.find((a) => a.id === analysisType)!;
                      const Icon = t.icon;
                      return (
                        <>
                          <Icon size={11} />
                          {t.label}
                        </>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <div
                    className="w-16 h-16 rounded-3xl flex items-center justify-center"
                    style={{
                      background: "rgba(248,113,113,0.1)",
                      border: "1px solid rgba(248,113,113,0.2)",
                    }}
                  >
                    <CameraOff size={28} className="text-red-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-white mb-1">Camera unavailable</p>
                    <p className="text-xs text-slate-500">
                      {cameraError ?? "Use the upload button below to select an image"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void startCamera(cameraFacing)}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                    style={{
                      background: "rgba(34,211,238,0.12)",
                      border: "1px solid rgba(34,211,238,0.28)",
                      color: "#22d3ee",
                    }}
                  >
                    Retry Camera
                  </button>
                </div>
              )}
            </div>

            {/* Capture / Upload buttons */}
            <div className="flex gap-3 pb-2">
              {cameraAvailable && (
                <button
                  type="button"
                  onClick={captureFromCamera}
                  className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: "linear-gradient(135deg,#0891b2,#22d3ee)",
                    boxShadow: "0 4px 24px rgba(34,211,238,0.4)",
                    color: "#030712",
                  }}
                >
                  <Camera size={18} />
                  Capture
                </button>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={clsx(
                  "flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]",
                  cameraAvailable ? "px-4" : "flex-1"
                )}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#94a3b8",
                }}
              >
                <Upload size={18} />
                {cameraAvailable ? "Upload" : "Choose Image"}
              </button>
            </div>
          </div>
        )}

        {/* ── Quota Exceeded screen ─────────────────────────────────────── */}
        {mode === "quota_exceeded" && quotaError && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
            {/* Icon */}
            <div className="relative">
              <div
                className="w-24 h-24 rounded-3xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, rgba(251,191,36,0.15), rgba(239,68,68,0.1))",
                  border: "1px solid rgba(251,191,36,0.25)",
                  boxShadow: "0 0 40px rgba(251,191,36,0.12)",
                }}
              >
                <Zap size={40} className="text-amber-400" />
              </div>
              {/* Pulse rings */}
              <div className="absolute inset-0 rounded-3xl animate-ping opacity-20"
                style={{ border: "2px solid #fbbf24" }} />
            </div>

            {/* Text */}
            <div className="text-center max-w-xs px-2">
              <h2 className="text-xl font-bold text-white mb-2">
                {quotaError.code === "PROVIDER_QUOTA" ? "All Providers Quota Full" : "Hourly Scan Limit Reached"}
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">{quotaError.message}</p>
            </div>

            {/* Countdown */}
            {retryCountdown > 0 && (
              <div
                className="flex flex-col items-center gap-1 px-8 py-4 rounded-2xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <p className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold">Retry available in</p>
                <p className="text-3xl font-black text-amber-400 tabular-nums">
                  {retryCountdown >= 3600
                    ? `${Math.floor(retryCountdown / 3600)}h ${Math.floor((retryCountdown % 3600) / 60)}m`
                    : retryCountdown >= 60
                    ? `${Math.floor(retryCountdown / 60)}m ${retryCountdown % 60}s`
                    : `${retryCountdown}s`}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {/* Add Manually — primary CTA */}
              <button
                type="button"
                onClick={() => navigate("/scan", { state: { prefill: null } })}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg,#7c3aed,#a855f7)",
                  boxShadow: "0 4px 24px rgba(139,92,246,0.35)",
                  color: "white",
                }}
              >
                <PackagePlus size={17} />
                Add Item Manually
              </button>

              {/* Try again (if countdown done) / Go to camera */}
              {retryCountdown === 0 ? (
                <button
                  type="button"
                  onClick={resetToCamera}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: "rgba(34,211,238,0.1)",
                    border: "1px solid rgba(34,211,238,0.28)",
                    color: "#22d3ee",
                  }}
                >
                  <RefreshCw size={15} />
                  Try Again
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resetToCamera}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Camera size={13} />
                  Back to Camera
                </button>
              )}
            </div>

            {/* Tip */}
            <div
              className="flex items-start gap-2 px-4 py-3 rounded-2xl max-w-xs"
              style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.1)" }}
            >
              <Info size={13} className="text-cyan-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-400">
                You can still <span className="text-cyan-300 font-semibold">add items manually</span> — scan a shelf QR to place them directly into inventory without AI analysis.
              </p>
            </div>
          </div>
        )}

        {/* Preview mode */}
        {mode === "preview" && capturedPreview && (
          <div className="flex flex-col gap-3 flex-1">
            {error && (
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-2xl"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
              >
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-400">Analysis failed</p>
                  <p className="text-xs text-red-300/70 mt-0.5 break-words">{error}</p>
                </div>
                <button type="button" onClick={() => setError(null)}>
                  <X size={14} className="text-red-400 hover:text-red-200 transition-colors" />
                </button>
              </div>
            )}

            <div
              className="relative flex-1 rounded-3xl overflow-hidden"
              style={{
                border: "1px solid rgba(34,211,238,0.15)",
                minHeight: 240,
              }}
            >
              <img
                src={capturedPreview}
                alt="Captured preview"
                className="w-full h-full object-contain"
                style={{ background: "#080e1c" }}
              />
              <button
                type="button"
                onClick={resetToCamera}
                className="absolute top-3 right-3 w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                style={{
                  background: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <X size={14} className="text-white" />
              </button>
            </div>

            <div className="flex gap-3 pb-2">
              <button
                type="button"
                onClick={runAnalysis}
                className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg,#0891b2,#22d3ee)",
                  boxShadow: "0 4px 24px rgba(34,211,238,0.4)",
                  color: "#030712",
                }}
              >
                <Sparkles size={18} />
                Analyze with AI
              </button>
              <button
                type="button"
                onClick={resetToCamera}
                className="px-4 py-4 rounded-2xl font-semibold text-sm text-slate-400 hover:text-white transition-all"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Analyzing state */}
        {mode === "analyzing" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6">
            {capturedPreview && (
              <div
                className="relative w-48 h-36 rounded-2xl overflow-hidden"
                style={{ border: "1px solid rgba(34,211,238,0.25)" }}
              >
                <img
                  src={capturedPreview}
                  alt="Analyzing"
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ background: "rgba(3,7,18,0.55)", backdropFilter: "blur(2px)" }}
                >
                  <Loader2 size={32} className="text-cyan-400 animate-spin" />
                </div>
              </div>
            )}
            <div className="text-center">
              <p className="text-base font-bold text-white mb-1">Analyzing image…</p>
              <p className="text-sm text-slate-500">
                {ANALYSIS_TYPES.find((a) => a.id === analysisType)?.desc ?? "Running AI analysis"}
              </p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full animate-bounce"
                  style={{
                    background: "#22d3ee",
                    animationDelay: `${i * 0.15}s`,
                    opacity: 0.7,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {mode === "results" && results && (
          <div className="flex flex-col gap-4 pb-2">

            {/* Summary row */}
            <div className="flex gap-3">
              {capturedPreview && (
                <div
                  className="w-20 h-16 rounded-2xl overflow-hidden shrink-0"
                  style={{ border: "1px solid rgba(34,211,238,0.15)" }}
                >
                  <img
                    src={capturedPreview}
                    alt="Scanned"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="px-2.5 py-1 rounded-xl text-xs font-bold"
                    style={{
                      background: "linear-gradient(135deg,#0891b2,#22d3ee)",
                      color: "#030712",
                    }}
                  >
                    {results.item_count} item{results.item_count !== 1 ? "s" : ""} found
                  </span>
                  {results.damage_detected && (
                    <span
                      className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold text-red-300"
                      style={{
                        background: "rgba(239,68,68,0.12)",
                        border: "1px solid rgba(239,68,68,0.25)",
                      }}
                    >
                      <AlertTriangle size={11} />
                      Damage
                    </span>
                  )}
                  {results.shelf_audit.organized && (
                    <span
                      className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold text-emerald-300"
                      style={{
                        background: "rgba(52,211,153,0.1)",
                        border: "1px solid rgba(52,211,153,0.2)",
                      }}
                    >
                      <CheckCircle2 size={11} />
                      Organized
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 capitalize">
                  {ANALYSIS_TYPES.find((a) => a.id === results.analysis_type)?.label ??
                    results.analysis_type}{" "}
                  analysis
                </p>
              </div>
            </div>

            {/* Damage alert */}
            {results.damage_detected && results.damage_notes && (
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-2xl"
                style={{
                  background: "rgba(239,68,68,0.07)",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
              >
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-400 mb-0.5">Damage detected</p>
                  <p className="text-xs text-red-300/80">{results.damage_notes}</p>
                </div>
              </div>
            )}

            {/* Detected items */}
            {results.detected_items.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Package size={12} />
                  Detected Items
                </h2>
                <div className="space-y-2">
                  {results.detected_items.map((item, idx) => (
                    <div
                      key={idx}
                      className="px-4 py-3 rounded-2xl"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">
                            {item.name || "Unknown item"}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {item.category && (
                              <span
                                className="px-1.5 py-0.5 rounded-lg text-[10px] font-medium text-cyan-300"
                                style={{ background: "rgba(34,211,238,0.08)" }}
                              >
                                {item.category}
                              </span>
                            )}
                            {item.brand && (
                              <span className="text-[10px] text-slate-500">{item.brand}</span>
                            )}
                            {item.model && (
                              <span className="text-[10px] text-slate-500">· {item.model}</span>
                            )}
                            {item.quantity > 1 && (
                              <span className="text-[10px] font-semibold text-amber-400">
                                ×{item.quantity}
                              </span>
                            )}
                          </div>
                          {item.notes && (
                            <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                              {item.notes}
                            </p>
                          )}
                          <div className="mt-2">
                            <ConfidenceBar value={item.confidence} />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addItemToInventory(item)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all hover:scale-105 active:scale-95"
                          style={{
                            background: "linear-gradient(135deg,#7c3aed,#a855f7)",
                            color: "white",
                            boxShadow: "0 2px 10px rgba(139,92,246,0.35)",
                          }}
                        >
                          <PackagePlus size={12} />
                          Review &amp; Add
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Metadata suggestions */}
            {results.metadata_suggestions &&
              Object.values(results.metadata_suggestions).some((v) =>
                Array.isArray(v) ? v.length > 0 : Boolean(v)
              ) && (
                <section>
                  <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Tag size={12} />
                    Metadata Suggestions
                  </h2>
                  <div
                    className="px-4 py-3 rounded-2xl space-y-2"
                    style={{
                      background: "rgba(34,211,238,0.04)",
                      border: "1px solid rgba(34,211,238,0.12)",
                    }}
                  >
                    {results.metadata_suggestions.category && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Category</span>
                        <span className="text-xs font-semibold text-cyan-300">
                          {results.metadata_suggestions.category}
                        </span>
                      </div>
                    )}
                    {results.metadata_suggestions.brand && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Brand</span>
                        <span className="text-xs font-semibold text-white">
                          {results.metadata_suggestions.brand}
                        </span>
                      </div>
                    )}
                    {results.metadata_suggestions.model && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Model</span>
                        <span className="text-xs font-semibold text-white">
                          {results.metadata_suggestions.model}
                        </span>
                      </div>
                    )}
                    {results.metadata_suggestions.usage_type && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Usage Type</span>
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-lg"
                          style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}
                        >
                          {results.metadata_suggestions.usage_type}
                        </span>
                      </div>
                    )}
                    {results.metadata_suggestions.tags?.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-slate-500 shrink-0">Tags</span>
                        <div className="flex flex-wrap gap-1">
                          {results.metadata_suggestions.tags.map((tag, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 rounded-lg text-[10px] font-medium text-slate-300"
                              style={{ background: "rgba(255,255,255,0.06)" }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

            {/* OCR text */}
            {results.ocr_text && (
              <section>
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <FileText size={12} />
                  Extracted Text
                </h2>
                <div
                  className="relative px-4 py-3 rounded-2xl"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-mono leading-relaxed pr-8">
                    {results.ocr_text}
                  </pre>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(results.ocr_text);
                      toast.success("OCR text copied");
                    }}
                    className="absolute top-3 right-3 w-7 h-7 rounded-xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                    style={{
                      background: "rgba(34,211,238,0.1)",
                      border: "1px solid rgba(34,211,238,0.2)",
                    }}
                  >
                    <Copy size={12} className="text-cyan-400" />
                  </button>
                </div>
              </section>
            )}

            {/* Shelf audit */}
            {results.shelf_audit?.total_visible > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <BarChart3 size={12} />
                  Shelf Audit
                </h2>
                <div
                  className="px-4 py-3 rounded-2xl space-y-2"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Total Visible</span>
                    <span className="text-xs font-bold text-white">
                      {results.shelf_audit.total_visible}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Organization</span>
                    {results.shelf_audit.organized ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
                        <CheckCircle2 size={11} />
                        Organized
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-semibold text-amber-400">
                        <AlertTriangle size={11} />
                        Needs attention
                      </span>
                    )}
                  </div>
                  {results.shelf_audit.issues?.length > 0 && (
                    <div className="pt-1 space-y-1">
                      {results.shelf_audit.issues.map((issue, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
                          <span className="text-xs text-amber-300/80">{issue}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Raw analysis toggle */}
            {results.raw_analysis && (
              <section>
                <button
                  type="button"
                  onClick={() => setShowRawAnalysis((v) => !v)}
                  className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Eye size={12} />
                  {showRawAnalysis ? "Hide" : "Show"} raw AI response
                </button>
                {showRawAnalysis && (
                  <div
                    className="mt-2 px-4 py-3 rounded-2xl"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
                      {results.raw_analysis}
                    </pre>
                  </div>
                )}
              </section>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={runAnalysis}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "rgba(34,211,238,0.08)",
                  border: "1px solid rgba(34,211,238,0.2)",
                  color: "#22d3ee",
                }}
              >
                <RefreshCw size={15} />
                Analyze Again
              </button>
              <button
                type="button"
                onClick={resetToCamera}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg,#0891b2,#22d3ee)",
                  boxShadow: "0 4px 20px rgba(34,211,238,0.35)",
                  color: "#030712",
                }}
              >
                <Camera size={15} />
                New Scan
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* ── Human Verification Sheet ── */}
      {reviewItem && (
        <ReviewSheet
          item={reviewItem}
          imagePreview={capturedPreview}
          onConfirm={confirmAndNavigate}
          onCancel={() => setReviewItem(null)}
        />
      )}
    </div>
  );
}
