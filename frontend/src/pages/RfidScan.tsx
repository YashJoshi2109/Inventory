import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wifi,
  CheckCircle2,
  XCircle,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Keyboard,
  Package,
  AlertTriangle,
  ChevronDown,
  Radio,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { rfidApi, type ResolvedRfidItem } from "@/api/rfid";
import { apiClient } from "@/api/client";
import { useThemeStore } from "@/store/theme";

const WS_URL = "ws://localhost:8765";
// True when running inside a Zebra MC3x / Android DataWedge context (no local bridge)
const IS_MOBILE = /android|iphone|ipad/i.test(navigator.userAgent);

interface ScannedEntry {
  epc: string;
  item: ResolvedRfidItem | null;
  count: number;
  lastAt: Date;
}

interface Area {
  id: number;
  name: string;
  code: string;
}

interface Location {
  id: number;
  name: string;
  code: string;
}

type ScanStatus = "idle" | "scanning" | "found" | "unknown";

const EPC_RE = /^[0-9A-Fa-f]{24}$/;
// DataWedge may emit "EPC:AABBCC..." or trailing whitespace — extract raw 24-hex
const extractEpc = (raw: string): string | null => {
  const m = raw.match(/[0-9A-Fa-f]{24}/);
  return m ? m[0].toUpperCase() : null;
};

export default function RfidScan() {
  const { theme } = useThemeStore();
  const isDark = theme === "dark";

  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [rawInput, setRawInput] = useState("");
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [lastEpc, setLastEpc] = useState<string | null>(null);
  const [lastItemName, setLastItemName] = useState<string | null>(null);
  const [session, setSession] = useState<ScannedEntry[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<"disconnected" | "connected" | "error">("disconnected");

  // Batch action state
  const [selectedAreaId, setSelectedAreaId] = useState<number | "">("");
  const [selectedLocationId, setSelectedLocationId] = useState<number | "">("");
  const [quantityEach, setQuantityEach] = useState(1);
  const [batchMsg, setBatchMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Fetch areas
  const { data: areas = [] } = useQuery<Area[]>({
    queryKey: ["rfid-areas"],
    queryFn: () => apiClient.get("/locations/areas").then((r) => r.data),
    staleTime: 60_000,
  });

  // Fetch locations for selected area
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["rfid-locations", selectedAreaId],
    queryFn: () =>
      apiClient.get("/locations", { params: { area_id: selectedAreaId } }).then((r) => r.data),
    enabled: !!selectedAreaId,
    staleTime: 60_000,
  });

  // Reset location when area changes
  useEffect(() => {
    setSelectedLocationId("");
  }, [selectedAreaId]);

  // Auto-focus hidden input on mount and on page click
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    focusInput();
    const refocus = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("select") && !t.closest("button") && !t.closest("[data-nofocus]")) {
        setTimeout(focusInput, 40);
      }
    };
    document.addEventListener("click", refocus);
    document.addEventListener("touchend", refocus as EventListener);
    return () => {
      document.removeEventListener("click", refocus);
      document.removeEventListener("touchend", refocus as EventListener);
    };
  }, [focusInput]);

  // Reset idle after short delay following found/unknown
  useEffect(() => {
    if (scanStatus === "found" || scanStatus === "unknown") {
      const t = setTimeout(() => setScanStatus("idle"), 2500);
      return () => clearTimeout(t);
    }
  }, [scanStatus]);

  // WebSocket bridge connection (RP902 MFi SPP → rfid_bridge.py → WS → here)
  // Skipped on mobile/Android — DataWedge keyboard wedge handles input instead.
  useEffect(() => {
    if (IS_MOBILE) return;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => setBridgeStatus("connected");

        ws.onmessage = (event) => {
          const epc = extractEpc((event.data as string).trim());
          if (epc) processEpc(epc);
        };

        ws.onclose = () => {
          setBridgeStatus("disconnected");
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          setBridgeStatus("error");
          ws.close();
        };
      } catch {
        setBridgeStatus("error");
        reconnectTimer = setTimeout(connect, 3000);
      }
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scan mutation ────────────────────────────────────────────────────────────

  const scanMutation = useMutation({
    mutationFn: (epc: string) => rfidApi.scan(epc),
    onSuccess: (data) => {
      if (data.found && data.item) {
        setScanStatus("found");
        setLastItemName(data.item.name);
        setSession((prev) => {
          const idx = prev.findIndex((e) => e.item?.item_id === data.item!.item_id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], count: next[idx].count + 1, lastAt: new Date() };
            return next;
          }
          return [{ epc: data.epc, item: data.item, count: 1, lastAt: new Date() }, ...prev];
        });
      } else {
        setScanStatus("unknown");
        setLastItemName(null);
        setSession((prev) => {
          const idx = prev.findIndex((e) => e.epc === data.epc);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], count: next[idx].count + 1 };
            return next;
          }
          return [{ epc: data.epc, item: null, count: 1, lastAt: new Date() }, ...prev];
        });
      }
    },
    onError: () => {
      setScanStatus("unknown");
      setLastItemName(null);
    },
  });

  const processEpc = useCallback(
    (epc: string) => {
      const clean = epc.trim().toUpperCase();
      if (!clean || scanStatus === "scanning") return;
      setScanStatus("scanning");
      setLastEpc(clean);
      setLastItemName(null);
      scanMutation.mutate(clean);
    },
    [scanStatus, scanMutation],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRawInput(val);
    // Fire immediately if exactly 24 hex chars (no Enter needed for some DataWedge configs)
    if (EPC_RE.test(val.trim())) {
      processEpc(val.trim());
      setRawInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && rawInput.trim()) {
      const epc = extractEpc(rawInput.trim());
      if (epc) processEpc(epc);
      setRawInput("");
    }
  };

  // ── Batch mutations ──────────────────────────────────────────────────────────

  const batchInMutation = useMutation({
    mutationFn: () =>
      rfidApi.batchStockIn(
        matchedItemIds,
        selectedLocationId as number,
        quantityEach,
      ),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.success).length;
      const fail = results.filter((r) => !r.success).length;
      setBatchMsg({ ok: fail === 0, text: `Stock In: ${ok} added${fail ? `, ${fail} failed` : ""}` });
      setTimeout(() => setBatchMsg(null), 3500);
    },
  });

  const batchOutMutation = useMutation({
    mutationFn: () =>
      rfidApi.batchStockOut(
        matchedItemIds,
        selectedLocationId as number,
        quantityEach,
      ),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.success).length;
      const fail = results.filter((r) => !r.success).length;
      setBatchMsg({ ok: fail === 0, text: `Stock Out: ${ok} removed${fail ? `, ${fail} failed` : ""}` });
      setTimeout(() => setBatchMsg(null), 3500);
    },
  });

  const matchedItemIds = session.filter((e) => e.item !== null).map((e) => e.item!.item_id);
  const canBatch = matchedItemIds.length > 0 && !!selectedLocationId;
  const isBatchBusy = batchInMutation.isPending || batchOutMutation.isPending;

  // ── Status colors / copy ─────────────────────────────────────────────────────

  const statusColor = {
    idle: "#8b5cf6",
    scanning: "#22d3ee",
    found: "#22c55e",
    unknown: "#ef4444",
  }[scanStatus];

  const statusLabel = {
    idle: "Ready to scan",
    scanning: "Processing...",
    found: lastItemName ?? "Item found",
    unknown: "EPC not recognised",
  }[scanStatus];

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const cardBg = isDark
    ? "rgba(12,18,48,0.72)"
    : "rgba(255,255,255,0.82)";
  const cardBorder = isDark
    ? "1px solid rgba(139,92,246,0.18)"
    : "1px solid rgba(139,92,246,0.20)";

  return (
    <div className="min-h-screen p-4 lg:p-6" style={{ background: "var(--bg-app)" }}>
      {/* Hidden EPC input — always focused, captures HID keyboard reader */}
      <input
        ref={inputRef}
        value={rawInput}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="absolute opacity-0 w-px h-px overflow-hidden pointer-events-none"
        aria-label="RFID EPC input"
        autoComplete="off"
        spellCheck={false}
        data-rfid="1"
      />

      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wifi size={20} style={{ color: "#8b5cf6" }} />
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              RFID Scan
            </h1>
          </div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Connect reader via USB/Bluetooth → pull trigger → items appear instantly
          </p>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Bridge status — only show on desktop */}
          {!IS_MOBILE && (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium"
              style={{
                background: bridgeStatus === "connected" ? "rgba(34,197,94,0.12)" : "rgba(139,92,246,0.10)",
                border: `1px solid ${bridgeStatus === "connected" ? "rgba(34,197,94,0.30)" : "rgba(139,92,246,0.22)"}`,
                color: bridgeStatus === "connected" ? "#22c55e" : "#a78bfa",
              }}
            >
              <Radio size={10} />
              {bridgeStatus === "connected" ? "Bridge connected" : "Bridge offline"}
            </div>
          )}
          {/* DataWedge badge on mobile */}
          {IS_MOBILE && (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium"
              style={{
                background: "rgba(251,191,36,0.10)",
                border: "1px solid rgba(251,191,36,0.28)",
                color: "#fbbf24",
              }}
            >
              <Radio size={10} />
              DataWedge mode
            </div>
          )}
          {/* HID / DataWedge focus indicator */}
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium"
            style={{
              background: isFocused ? "rgba(34,211,238,0.10)" : "rgba(100,116,139,0.08)",
              border: `1px solid ${isFocused ? "rgba(34,211,238,0.28)" : "rgba(100,116,139,0.18)"}`,
              color: isFocused ? "#22d3ee" : "var(--text-muted)",
            }}
          >
            <Keyboard size={10} />
            {isFocused ? "Ready — pull trigger" : IS_MOBILE ? "Tap screen to focus" : "Click to focus HID"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── Scan zone ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Status card */}
          <div
            className="rounded-2xl p-6 flex flex-col items-center justify-center text-center min-h-[280px] relative overflow-hidden"
            style={{
              background: cardBg,
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: cardBorder,
              boxShadow: isDark
                ? "0 16px 48px rgba(0,0,0,0.35)"
                : "0 8px 32px rgba(0,0,0,0.08)",
            }}
          >
            {/* Background glow */}
            <div
              className="absolute inset-0 rounded-2xl transition-opacity duration-700"
              style={{
                background: `radial-gradient(ellipse at 50% 40%, ${statusColor}22 0%, transparent 70%)`,
              }}
            />

            {/* RFID pulse rings */}
            <div className="relative mb-5">
              {(scanStatus === "idle" || scanStatus === "scanning") && (
                <>
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    style={{ border: `1.5px solid ${statusColor}`, opacity: 0.3 }}
                    animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                  />
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    style={{ border: `1.5px solid ${statusColor}`, opacity: 0.2 }}
                    animate={{ scale: [1, 1.5], opacity: [0.2, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: 0.5 }}
                  />
                </>
              )}
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center relative"
                style={{ background: `${statusColor}22`, border: `2px solid ${statusColor}55` }}
              >
                <motion.div
                  animate={scanStatus === "scanning" ? { rotate: 360 } : { rotate: 0 }}
                  transition={{ duration: 1, repeat: scanStatus === "scanning" ? Infinity : 0, ease: "linear" }}
                >
                  <Wifi size={28} style={{ color: statusColor }} />
                </motion.div>
              </div>
            </div>

            {/* Status text */}
            <AnimatePresence mode="wait">
              <motion.div
                key={scanStatus + lastItemName}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="relative space-y-1"
              >
                <div className="flex items-center justify-center gap-1.5">
                  {scanStatus === "found" && <CheckCircle2 size={15} style={{ color: "#22c55e" }} />}
                  {scanStatus === "unknown" && <XCircle size={15} style={{ color: "#ef4444" }} />}
                  <p className="text-sm font-semibold" style={{ color: statusColor }}>
                    {statusLabel}
                  </p>
                </div>
                {lastEpc && scanStatus !== "idle" && (
                  <p className="text-[10px] font-mono opacity-60" style={{ color: "var(--text-muted)" }}>
                    {lastEpc}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Manual EPC input (for testing without reader) */}
          <div
            className="rounded-2xl p-4"
            style={{ background: cardBg, backdropFilter: "blur(20px)", border: cardBorder }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--text-muted)" }}>
              Manual EPC entry
            </p>
            <div className="flex gap-2">
              <input
                data-nofocus="1"
                placeholder="Enter 24-char EPC hex..."
                className="flex-1 rounded-xl px-3 py-2 text-[12px] font-mono outline-none"
                style={{
                  background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-primary)",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      processEpc(val);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }
                }}
              />
              <button
                data-nofocus="1"
                className="px-3 py-2 rounded-xl text-[11px] font-semibold transition-all"
                style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.30)", color: "#a78bfa" }}
                onClick={(e) => {
                  const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                  const val = input.value.trim();
                  if (val) {
                    processEpc(val);
                    input.value = "";
                  }
                }}
              >
                Scan
              </button>
            </div>
          </div>

          {/* How-to guide */}
          <div
            className="rounded-xl p-4 space-y-2"
            style={{
              background: isDark ? "rgba(139,92,246,0.07)" : "rgba(139,92,246,0.05)",
              border: "1px solid rgba(139,92,246,0.14)",
            }}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#a78bfa" }}>
              {IS_MOBILE ? "Zebra MC3300R Setup" : "How it works"}
            </p>
            {(IS_MOBILE ? [
              "Open DataWedge → Create profile → Associate with Chrome",
              "Input: RFID Reader · Output: Keystroke · Send ENTER after scan: ON",
              "Data formatting: EPC only (hex, no spaces)",
              "Tap this screen to focus, pull trigger — item appears instantly",
            ] : [
              "Run tools/rfid_bridge.py on your computer",
              "Pair RP902 via Bluetooth → bridge auto-detects port",
              "Pull trigger — EPC sent via WebSocket automatically",
              "Collect items, pick location, stock in/out",
            ]).map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5"
                  style={{ background: "rgba(139,92,246,0.20)", color: "#a78bfa" }}
                >
                  {i + 1}
                </span>
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{step}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Session panel ──────────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Session header */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: cardBg, backdropFilter: "blur(24px)", border: cardBorder }}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: "var(--border-card)" }}>
              <div className="flex items-center gap-2">
                <Package size={14} style={{ color: "#8b5cf6" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Session Items
                </span>
                {session.length > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: "rgba(139,92,246,0.18)", color: "#a78bfa" }}
                  >
                    {session.length}
                  </span>
                )}
              </div>
              {session.length > 0 && (
                <button
                  data-nofocus="1"
                  onClick={() => { setSession([]); setBatchMsg(null); }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition-all"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border-card)" }}
                >
                  <Trash2 size={10} />
                  Clear
                </button>
              )}
            </div>

            {/* Items list */}
            <div
              className="overflow-y-auto"
              style={{ maxHeight: "calc(5 * 60px)", scrollbarWidth: "thin", scrollbarColor: "var(--border-card) transparent" }}
            >
              {session.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <Wifi size={28} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>No items scanned yet</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {session.map((entry) => (
                    <motion.div
                      key={entry.epc}
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.18 }}
                      className="flex items-center gap-3 px-5 py-3.5 border-b"
                      style={{ borderColor: "var(--border-card)" }}
                    >
                      {/* Status dot */}
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: entry.item ? "#22c55e" : "#ef4444" }}
                      />

                      <div className="flex-1 min-w-0">
                        {entry.item ? (
                          <>
                            <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                              {entry.item.name}
                            </p>
                            <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                              {entry.item.sku} · {entry.item.category} · {entry.item.total_quantity} {entry.item.unit}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-medium" style={{ color: "#ef4444" }}>Unknown EPC</p>
                            <p className="text-[10px] font-mono truncate" style={{ color: "var(--text-muted)" }}>
                              {entry.epc}
                            </p>
                          </>
                        )}
                      </div>

                      {entry.count > 1 && (
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0"
                          style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee" }}
                        >
                          ×{entry.count}
                        </span>
                      )}

                      {entry.item && entry.item.total_quantity <= entry.item.reorder_level && (
                        <AlertTriangle size={12} style={{ color: "#f59e0b", flexShrink: 0 }} />
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>

          {/* Batch actions */}
          <div
            className="rounded-2xl p-5 space-y-4"
            style={{ background: cardBg, backdropFilter: "blur(24px)", border: cardBorder }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Batch Actions · {matchedItemIds.length} item{matchedItemIds.length !== 1 ? "s" : ""} matched
            </p>

            {/* Location selectors */}
            <div className="grid grid-cols-2 gap-3">
              {/* Area */}
              <div className="relative">
                <select
                  data-nofocus="1"
                  value={selectedAreaId}
                  onChange={(e) => setSelectedAreaId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full rounded-xl px-3 py-2.5 text-[12px] appearance-none outline-none pr-8"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    border: "1px solid var(--border-card)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="">Select area…</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
              </div>

              {/* Location */}
              <div className="relative">
                <select
                  data-nofocus="1"
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full rounded-xl px-3 py-2.5 text-[12px] appearance-none outline-none pr-8"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    border: "1px solid var(--border-card)",
                    color: "var(--text-primary)",
                  }}
                  disabled={!selectedAreaId}
                >
                  <option value="">Select location…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
              </div>
            </div>

            {/* Quantity */}
            <div className="flex items-center gap-3">
              <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Qty per item</span>
              <div className="flex items-center gap-1">
                <button
                  data-nofocus="1"
                  onClick={() => setQuantityEach((q) => Math.max(1, q - 1))}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-lg font-bold"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {quantityEach}
                </span>
                <button
                  data-nofocus="1"
                  onClick={() => setQuantityEach((q) => q + 1)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-lg font-bold"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Batch feedback */}
            <AnimatePresence>
              {batchMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium"
                  style={{
                    background: batchMsg.ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                    border: `1px solid ${batchMsg.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                    color: batchMsg.ok ? "#22c55e" : "#ef4444",
                  }}
                >
                  {batchMsg.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  {batchMsg.text}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                data-nofocus="1"
                disabled={!canBatch || isBatchBusy}
                onClick={() => { setBatchMsg(null); batchInMutation.mutate(); }}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all disabled:opacity-40"
                style={{
                  background: "rgba(34,197,94,0.12)",
                  border: "1px solid rgba(34,197,94,0.28)",
                  color: "#22c55e",
                }}
              >
                {batchInMutation.isPending ? (
                  <RotateCcw size={12} className="animate-spin" />
                ) : (
                  <ArrowDownToLine size={13} />
                )}
                Stock In
              </button>
              <button
                data-nofocus="1"
                disabled={!canBatch || isBatchBusy}
                onClick={() => { setBatchMsg(null); batchOutMutation.mutate(); }}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all disabled:opacity-40"
                style={{
                  background: "rgba(239,68,68,0.10)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#ef4444",
                }}
              >
                {batchOutMutation.isPending ? (
                  <RotateCcw size={12} className="animate-spin" />
                ) : (
                  <ArrowUpFromLine size={13} />
                )}
                Stock Out
              </button>
            </div>

            {!canBatch && (
              <p className="text-[11px] text-center" style={{ color: "var(--text-muted)" }}>
                {matchedItemIds.length === 0
                  ? "Scan at least one recognised item"
                  : "Select a location to enable batch actions"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
