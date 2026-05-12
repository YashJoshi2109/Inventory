import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package, MapPin, CheckCircle2, XCircle, RotateCcw,
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Loader2,
  Minus, Plus,
} from "lucide-react";
import toast from "react-hot-toast";
import { BarcodeScanner } from "@/components/scanner/BarcodeScanner";
import { scanApi, type SmartApplyResponse, type SmartAction, type CandidateSource } from "@/api/transactions";
import { useThemeStore } from "@/store/theme";
import type { ScanResult } from "@/types";

// ─── State Machine Types ──────────────────────────────────────────────────────

type SmartPhase =
  | "idle"
  | "item_scanned"
  | "location_scanned"
  | "previewing"
  | "committing"
  | "success"
  | "error";

interface SmartState {
  phase: SmartPhase;
  item?: ScanResult;
  location?: ScanResult;
  preview?: SmartApplyResponse;
  selectedSourceId?: number | null;
  quantity: number;
  errorMsg?: string;
}

const ACTION_COLOR: Record<SmartAction, string> = {
  stock_in: "#059669",
  stock_out: "#DC2626",
  transfer: "#2563EB",
};

const ACTION_LABEL: Record<SmartAction, string> = {
  stock_in: "Add to rack",
  stock_out: "Remove from rack",
  transfer: "Transfer to rack",
};

const ACTION_ICON: Record<SmartAction, typeof ArrowUpRight> = {
  stock_in: ArrowUpRight,
  stock_out: ArrowDownRight,
  transfer: ArrowLeftRight,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apiErrMsg(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return (detail as { msg: string }[]).map((d) => d.msg).join(", ");
  return "Something went wrong";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScanCard({
  icon: Icon, label, name, code, color, isDark,
}: {
  icon: typeof Package; label: string; name: string; code: string; color: string; isDark: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3"
      style={{
        background: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.80)",
        border: "1px solid var(--border-card)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${color}22`, border: `1px solid ${color}44` }}
      >
        <Icon size={16} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>{label}</p>
        <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{name}</p>
        <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{code}</p>
      </div>
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-3 h-3 rounded-full transition-all duration-300"
        style={{
          background: done || active ? "var(--accent)" : "var(--border-card)",
          opacity: done || active ? 1 : 0.4,
          boxShadow: active ? "0 0 0 4px rgba(37,99,235,0.25)" : "none",
        }}
      />
      <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

function QtyStepper({ value, onChange, isDark }: { value: number; onChange: (n: number) => void; isDark: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-2 py-1"
      style={{
        background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        border: "1px solid var(--border-card)",
      }}
    >
      <button
        onClick={() => onChange(Math.max(1, value - 1))}
        className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ color: "var(--text-primary)" }}
        aria-label="Decrease quantity"
      >
        <Minus size={14} />
      </button>
      <span className="w-8 text-center text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</span>
      <button
        onClick={() => onChange(value + 1)}
        className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ color: "var(--text-primary)" }}
        aria-label="Increase quantity"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SmartScan() {
  const isDark = useThemeStore((s) => s.theme) === "dark";
  const [state, setState] = useState<SmartState>({ phase: "idle", quantity: 1 });
  const scanning = useRef(true);

  const reset = useCallback(() => {
    scanning.current = true;
    setState({ phase: "idle", quantity: 1 });
  }, []);

  useEffect(() => {
    if (state.phase === "success") {
      const t = setTimeout(reset, 4000);
      return () => clearTimeout(t);
    }
  }, [state.phase, reset]);

  const fetchPreview = useCallback(async (
    item: ScanResult,
    location: ScanResult,
    quantity: number,
    sourceLocationId?: number,
  ) => {
    scanning.current = false;
    try {
      const preview = await scanApi.smartApply({
        item_id: item.id!,
        location_id: location.id!,
        quantity,
        dry_run: true,
        source_location_id: sourceLocationId,
      });
      setState((s) => ({
        ...s,
        phase: "previewing",
        item, location, preview, quantity,
        selectedSourceId: sourceLocationId ?? preview.source_location_id ?? null,
      }));
    } catch (err) {
      setState((s) => ({ ...s, phase: "error", errorMsg: apiErrMsg(err) }));
    }
  }, []);

  const commit = useCallback(async () => {
    if (!state.item || !state.location || !state.preview) return;
    setState((s) => ({ ...s, phase: "committing" }));
    try {
      const result = await scanApi.smartApply({
        item_id: state.item.id!,
        location_id: state.location.id!,
        quantity: state.quantity,
        dry_run: false,
        source_location_id: state.selectedSourceId ?? undefined,
      });
      setState((s) => ({ ...s, phase: "success", preview: result }));
    } catch (err) {
      setState((s) => ({ ...s, phase: "error", errorMsg: apiErrMsg(err) }));
    }
  }, [state.item, state.location, state.preview, state.quantity, state.selectedSourceId]);

  useEffect(() => {
    if (state.phase !== "previewing" || !state.item || !state.location) return;
    const needsRefetch =
      state.preview?.requires_source_selection && state.selectedSourceId != null;
    if (needsRefetch) {
      fetchPreview(state.item, state.location, state.quantity, state.selectedSourceId ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedSourceId]);

  const onQuantityChange = useCallback((n: number) => {
    setState((s) => ({ ...s, quantity: n }));
    if (state.item && state.location) {
      fetchPreview(state.item, state.location, n, state.selectedSourceId ?? undefined);
    }
  }, [state.item, state.location, state.selectedSourceId, fetchPreview]);

  const onScan = useCallback(async (raw: string) => {
    if (!scanning.current) return;

    let resolved: ScanResult;
    try {
      resolved = await scanApi.lookup(raw);
    } catch {
      toast.error("Unrecognised barcode", { duration: 1500 });
      return;
    }
    if (resolved.result_type === "unknown") {
      toast.error("Barcode not in system", { duration: 1500 });
      return;
    }

    setState((prev) => {
      if (resolved.result_type === "item" && prev.item?.id === resolved.id) {
        toast("Item already scanned", { duration: 1200 });
        return prev;
      }
      if (resolved.result_type === "location" && prev.location?.id === resolved.id) {
        toast("Rack already scanned", { duration: 1200 });
        return prev;
      }

      if (resolved.result_type === "item") {
        if (prev.phase === "location_scanned" && prev.location) {
          fetchPreview(resolved, prev.location, prev.quantity);
          return { ...prev, item: resolved };
        }
        return { ...prev, phase: "item_scanned", item: resolved };
      }

      if (resolved.result_type === "location") {
        if (prev.phase === "item_scanned" && prev.item) {
          fetchPreview(prev.item, resolved, prev.quantity);
          return { ...prev, location: resolved };
        }
        return { ...prev, phase: "location_scanned", location: resolved };
      }

      return prev;
    });
  }, [fetchPreview]);

  const itemDone = !!state.item;
  const locationDone = !!state.location;
  const ActionIcon = state.preview ? ACTION_ICON[state.preview.action] : ArrowUpRight;
  const actionColor = state.preview ? ACTION_COLOR[state.preview.action] : "var(--accent)";

  return (
    <div
      className="flex flex-col h-full relative overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* ── Camera ── */}
      <div className="flex-1 relative min-h-0">
        <BarcodeScanner
          onScan={onScan}
          autoStart
          hint={
            state.phase === "idle" ? "Scan item barcode or rack QR" :
            state.phase === "item_scanned" ? "Now scan a rack QR code" :
            state.phase === "location_scanned" ? "Now scan an item barcode" :
            undefined
          }
          className="w-full h-full"
        />

        {/* Step indicators */}
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-6 px-5 py-2 rounded-full"
          style={{
            background: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.70)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--border-card)",
          }}
        >
          <StepDot active={!itemDone} done={itemDone} label="Item" />
          <div className="w-8 h-px" style={{ background: "var(--border-card)" }} />
          <StepDot active={itemDone && !locationDone} done={locationDone} label="Rack" />
          <div className="w-8 h-px" style={{ background: "var(--border-card)" }} />
          <StepDot active={state.phase === "previewing"} done={state.phase === "success"} label="Confirm" />
        </div>
      </div>

      {/* ── Bottom Panel ── */}
      <div
        className="shrink-0 p-4 space-y-3 max-h-[60vh] overflow-y-auto"
        style={{
          background: isDark
            ? "linear-gradient(180deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.98) 100%)"
            : "linear-gradient(180deg, rgba(241,245,249,0.85) 0%, rgba(241,245,249,0.98) 100%)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid var(--border-card)",
        }}
      >
        {state.phase === "idle" && (
          <p className="text-center text-sm py-2" style={{ color: "var(--text-muted)" }}>Scan any barcode to begin</p>
        )}

        {state.phase === "item_scanned" && state.item && (
          <>
            <ScanCard icon={Package} label="Item" name={state.item.name} code={state.item.code} color="#2563EB" isDark={isDark} />
            <p className="text-center text-xs py-1" style={{ color: "var(--text-muted)" }}>Scan a rack QR to continue</p>
          </>
        )}

        {state.phase === "location_scanned" && state.location && (
          <>
            <ScanCard icon={MapPin} label="Rack" name={state.location.name} code={state.location.code} color="#7C3AED" isDark={isDark} />
            <p className="text-center text-xs py-1" style={{ color: "var(--text-muted)" }}>Scan an item barcode to continue</p>
          </>
        )}

        {/* ── PREVIEW ── */}
        {state.phase === "previewing" && state.item && state.location && state.preview && (
          <>
            <ScanCard icon={Package} label="Item" name={state.item.name} code={state.item.code} color="#2563EB" isDark={isDark} />
            <ScanCard icon={MapPin} label="Rack" name={state.location.name} code={state.location.code} color="#7C3AED" isDark={isDark} />

            {/* Source picker — transfer with multiple candidates */}
            {state.preview.action === "transfer" && state.preview.candidate_sources.length > 1 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>
                  Transfer from
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {state.preview.candidate_sources.map((c: CandidateSource) => (
                    <button
                      key={c.location_id}
                      onClick={() => setState((s) => ({ ...s, selectedSourceId: c.location_id }))}
                      className="text-left rounded-lg px-3 py-2 transition-all"
                      style={{
                        background: state.selectedSourceId === c.location_id
                          ? `${actionColor}22`
                          : (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
                        border: `1px solid ${state.selectedSourceId === c.location_id ? actionColor : "var(--border-card)"}`,
                      }}
                    >
                      <p className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>{c.location_name}</p>
                      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>qty {c.quantity}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Action summary + qty stepper */}
            <div
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ background: `${actionColor}18`, border: `1px solid ${actionColor}44` }}
            >
              <div className="flex items-center gap-2">
                <ActionIcon size={18} style={{ color: actionColor }} />
                <div>
                  <span className="text-sm font-bold" style={{ color: actionColor }}>
                    {ACTION_LABEL[state.preview.action]}
                  </span>
                  {state.preview.action === "transfer" && state.preview.source_location_name && (
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      from {state.preview.source_location_name}
                    </p>
                  )}
                </div>
              </div>
              <QtyStepper value={state.quantity} onChange={onQuantityChange} isDark={isDark} />
            </div>

            {/* Quantity delta */}
            <div className="flex items-center justify-between text-xs px-1" style={{ color: "var(--text-muted)" }}>
              <span>Stock at {state.location.name}</span>
              <span className="tabular-nums">
                {state.preview.previous_quantity} → <span style={{ color: actionColor, fontWeight: 700 }}>{state.preview.new_quantity}</span>
              </span>
            </div>

            {/* Confirm + Cancel */}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                onClick={commit}
                disabled={state.preview.requires_source_selection && state.selectedSourceId == null}
                className="py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                style={{ background: actionColor, color: "#fff" }}
              >
                Confirm
              </button>
              <button
                onClick={reset}
                className="px-4 py-3 rounded-xl text-sm"
                style={{ border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {state.phase === "committing" && (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Saving…</span>
          </div>
        )}

        {state.phase === "success" && state.preview && state.item && state.location && (
          <>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={28} style={{ color: ACTION_COLOR[state.preview.action] }} />
              <div>
                <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                  {state.preview.action === "stock_in" && "Stock added"}
                  {state.preview.action === "stock_out" && "Stock removed"}
                  {state.preview.action === "transfer" && "Transfer complete"}
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {state.item.name} · {state.location.name}
                </p>
              </div>
            </div>
            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
              style={{
                background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                border: "1px solid var(--border-card)",
                color: "var(--text-primary)",
              }}
            >
              <RotateCcw size={14} /> Scan another
            </button>
          </>
        )}

        {state.phase === "error" && (
          <>
            <div className="flex items-center gap-3">
              <XCircle size={28} style={{ color: "#DC2626" }} />
              <div>
                <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>Failed</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{state.errorMsg}</p>
              </div>
            </div>
            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
              style={{
                background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                border: "1px solid var(--border-card)",
                color: "var(--text-primary)",
              }}
            >
              <RotateCcw size={14} /> Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
