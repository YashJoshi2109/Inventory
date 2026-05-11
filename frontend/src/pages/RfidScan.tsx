import { useCallback, useEffect, useRef, useState } from "react";
import {
  Radio, Keyboard, AlertCircle, CheckCircle2,
  Trash2, ArrowUpRight, ArrowDownRight, Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import { rfidApi, type ResolvedRfidItem } from "@/api/rfid";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useThemeStore } from "@/store/theme";

interface SessionEntry {
  epc: string;
  item: ResolvedRfidItem | null;
  selected: boolean;
}

type ActionMode = "none" | "stock_in" | "stock_out";

interface LocationOption {
  id: number;
  name: string;
  code: string;
}

export function RfidScan() {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<Set<string>>(new Set());

  const [epcInput, setEpcInput] = useState("");
  const [session, setSession] = useState<SessionEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>("none");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [quantityEach, setQuantityEach] = useState(1);
  const [actionNote, setActionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    apiClient.get("/locations").then((r) => {
      const data = r.data?.items ?? r.data ?? [];
      setLocations(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, []);

  const resolveEpc = useCallback(async (raw: string) => {
    const epc = raw.trim().toUpperCase();
    if (!epc || sessionRef.current.has(epc)) {
      setEpcInput("");
      inputRef.current?.focus();
      return;
    }
    sessionRef.current.add(epc);
    setScanning(true);
    try {
      const result = await rfidApi.scanEpc(epc);
      setSession((prev) => [...prev, { epc, item: result.item, selected: true }]);
      if (result.found && result.item) {
        toast.success(`Found: ${result.item.name}`, { duration: 1500 });
      } else {
        toast(`Unknown EPC`, { icon: "⚠️", duration: 2000 });
      }
    } catch {
      sessionRef.current.delete(epc);
      toast.error("Scan failed");
    } finally {
      setScanning(false);
      setEpcInput("");
      inputRef.current?.focus();
    }
  }, []);

  const handleChange = (value: string) => {
    setEpcInput(value);
    // RP902 HID sometimes omits Enter — auto-submit after 24 hex chars + 150ms idle
    if (value.trim().length >= 24 && /^[0-9A-Fa-f]+$/.test(value.trim())) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => resolveEpc(value), 150);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      resolveEpc(epcInput);
    }
  };

  const toggleSelect = (epc: string) =>
    setSession((prev) => prev.map((e) => e.epc === epc ? { ...e, selected: !e.selected } : e));

  const clearSession = () => {
    setSession([]);
    sessionRef.current.clear();
    setActionMode("none");
    setActionNote("");
  };

  const selectedItems = session.filter((e) => e.selected && e.item !== null);
  const selectedItemIds = selectedItems.map((e) => e.item!.item_id);
  const matchedCount = session.filter((e) => e.item !== null).length;
  const unknownCount = session.filter((e) => e.item === null).length;

  const handleBatchAction = async () => {
    if (!locationId) { toast.error("Select a location first"); return; }
    if (selectedItemIds.length === 0) { toast.error("No items selected"); return; }
    setSubmitting(true);
    try {
      const base = { item_ids: selectedItemIds, location_id: locationId, quantity_each: quantityEach };
      const results = actionMode === "stock_in"
        ? await rfidApi.batchStockIn({ ...base, notes: actionNote || undefined })
        : await rfidApi.batchStockOut({ ...base, reason: actionNote || undefined });
      const ok = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      if (ok.length) toast.success(`${actionMode === "stock_in" ? "Stocked in" : "Stocked out"} ${ok.length} item(s)`);
      if (failed.length) toast.error(`${failed.length} failed: ${failed.map((f) => f.error).join("; ")}`);
      const successIds = new Set(ok.map((r) => r.item_id));
      setSession((prev) => prev.filter((e) => !e.item || !successIds.has(e.item.item_id)));
      ok.forEach((r) => {
        const entry = session.find((e) => e.item?.item_id === r.item_id);
        if (entry) sessionRef.current.delete(entry.epc);
      });
      setActionMode("none");
      setActionNote("");
    } catch {
      toast.error("Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  const glass: React.CSSProperties = {
    background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.75)",
    backdropFilter: "blur(12px)",
    border: "1px solid var(--border-card)",
    borderRadius: 16,
  };

  const itemStatus = (item: ResolvedRfidItem) =>
    item.total_quantity <= 0 ? "OUT" : item.total_quantity <= item.reorder_level ? "LOW" : "OK";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(37,99,235,0.12)", border: "1px solid rgba(37,99,235,0.3)" }}>
          <Radio size={20} style={{ color: "var(--accent)" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>RFID Scan</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            RP902 via Bluetooth · HID keyboard mode
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: "rgba(37,99,235,0.10)", border: "1px solid rgba(37,99,235,0.25)", color: "var(--accent)" }}>
          <Keyboard size={11} /> HID
        </div>
      </div>

      {/* EPC input */}
      <div style={glass} className="p-5 space-y-3">
        <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
          Keep this field focused · pull RP902 trigger to scan
        </p>
        <div className="relative">
          <input
            ref={inputRef}
            value={epcInput}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Waiting for RFID scan… (or type EPC manually)"
            className="w-full px-4 py-3 rounded-xl text-sm font-mono"
            style={{
              background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.9)",
              border: "2px solid var(--accent)",
              color: "var(--text-primary)",
              outline: "none",
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {scanning && (
            <Loader2 size={16} className="animate-spin absolute right-3 top-3.5"
              style={{ color: "var(--accent)" }} />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {matchedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "rgba(5,150,105,0.12)", color: "var(--accent-success)" }}>
              {matchedCount} matched
            </span>
          )}
          {unknownCount > 0 && (
            <span className="px-2 py-0.5 rounded-full font-semibold"
              style={{ background: "rgba(220,38,38,0.10)", color: "var(--accent-danger)" }}>
              {unknownCount} unknown
            </span>
          )}
          {session.length > 0 && (
            <button onClick={clearSession}
              className="ml-auto flex items-center gap-1 hover:opacity-70 transition-opacity"
              style={{ color: "var(--text-muted)" }}>
              <Trash2 size={12} /> Clear session
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      {session.length > 0 && (
        <div style={glass} className="p-4 space-y-2">
          <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Scanned ({session.length})
          </p>
          {session.map((entry) => (
            <button
              key={entry.epc}
              onClick={() => entry.item && toggleSelect(entry.epc)}
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left"
              style={{
                background: entry.selected && entry.item
                  ? isDark ? "rgba(37,99,235,0.15)" : "rgba(37,99,235,0.08)"
                  : isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.6)",
                border: entry.selected && entry.item
                  ? "1px solid rgba(37,99,235,0.4)"
                  : "1px solid var(--border-card)",
                cursor: entry.item ? "pointer" : "default",
              }}
            >
              {entry.item ? (
                <>
                  <CheckCircle2 size={16} style={{ color: entry.selected ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {entry.item.name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {entry.item.sku} · {entry.item.total_quantity} {entry.item.unit} in stock
                    </p>
                  </div>
                  <Badge variant={itemStatus(entry.item) === "OUT" ? "danger" : itemStatus(entry.item) === "LOW" ? "warning" : "success"}>
                    {itemStatus(entry.item)}
                  </Badge>
                </>
              ) : (
                <>
                  <AlertCircle size={16} style={{ color: "var(--accent-danger)", flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono truncate" style={{ color: "var(--accent-danger)" }}>{entry.epc}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>Unknown EPC — not in inventory</p>
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Action panel */}
      {matchedCount > 0 && (
        <div style={glass} className="p-5 space-y-4">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Apply Action · {selectedItems.length} item(s) selected
          </p>

          <div className="flex gap-2">
            {(["stock_in", "stock_out"] as const).map((mode) => (
              <button key={mode}
                onClick={() => setActionMode(actionMode === mode ? "none" : mode)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: actionMode === mode
                    ? mode === "stock_in" ? "rgba(5,150,105,0.15)" : "rgba(220,38,38,0.12)"
                    : isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.8)",
                  border: actionMode === mode
                    ? mode === "stock_in" ? "1px solid rgba(5,150,105,0.4)" : "1px solid rgba(220,38,38,0.3)"
                    : "1px solid var(--border-card)",
                  color: actionMode === mode
                    ? mode === "stock_in" ? "var(--accent-success)" : "var(--accent-danger)"
                    : "var(--text-primary)",
                }}>
                {mode === "stock_in" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                {mode === "stock_in" ? "Stock In" : "Stock Out"}
              </button>
            ))}
          </div>

          {actionMode !== "none" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  Location
                </label>
                <select
                  value={locationId ?? ""}
                  onChange={(e) => setLocationId(Number(e.target.value) || null)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{
                    background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.9)",
                    border: "1px solid var(--border-card)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="">Select location…</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  Qty per item
                </label>
                <Input
                  type="number"
                  min={1}
                  value={quantityEach}
                  onChange={(e) => setQuantityEach(Math.max(1, Number(e.target.value)))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  {actionMode === "stock_out" ? "Reason (optional)" : "Notes (optional)"}
                </label>
                <Input
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder={actionMode === "stock_out" ? "Checkout, damaged, used…" : "PO reference…"}
                />
              </div>

              <Button
                onClick={handleBatchAction}
                disabled={submitting || !locationId || selectedItemIds.length === 0}
                variant={actionMode === "stock_in" ? "primary" : "danger"}
                className="w-full"
              >
                {submitting
                  ? <Loader2 size={16} className="animate-spin mr-2" />
                  : actionMode === "stock_in"
                    ? <ArrowUpRight size={16} className="mr-2" />
                    : <ArrowDownRight size={16} className="mr-2" />}
                Confirm {actionMode === "stock_in" ? "Stock In" : "Stock Out"} ({selectedItemIds.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {session.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto"
            style={{ background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", border: "1px dashed var(--border-card)" }}>
            <Radio size={28} style={{ color: "var(--text-muted)" }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Ready to scan</p>
          <p className="text-xs max-w-xs mx-auto leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Pair RP902 via Bluetooth · set output mode to HID in TagAccess · keep input focused · pull trigger
          </p>
        </div>
      )}
    </div>
  );
}
