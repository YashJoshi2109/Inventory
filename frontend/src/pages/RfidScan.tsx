import { useCallback, useEffect, useRef, useState } from "react";
import {
  Radio, AlertCircle, CheckCircle2, Trash2,
  ArrowUpRight, ArrowDownRight, Loader2, Bluetooth,
  BluetoothConnected, BluetoothOff, ChevronDown, ChevronUp,
} from "lucide-react";
import toast from "react-hot-toast";
import { rfidApi, type ResolvedRfidItem } from "@/api/rfid";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useThemeStore } from "@/store/theme";

// ── Known Unitech / RFID BLE GATT UUIDs (tried in order) ─────────────────────
// Nordic UART Service (NUS) — most common BLE serial-over-RFID readers
const UART_SERVICE   = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX_CHAR   = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // device → app
// Unitech proprietary service (common across their BLE scanners)
const UNITECH_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
const UNITECH_NOTIFY  = "0000fff1-0000-1000-8000-00805f9b34fb";

interface GattService { uuid: string; chars: string[] }
interface SessionEntry { epc: string; item: ResolvedRfidItem | null; selected: boolean }
type ActionMode = "none" | "stock_in" | "stock_out";
interface LocationOption { id: number; name: string; code: string }
type ConnState = "disconnected" | "connecting" | "connected" | "error";

// ── Web Bluetooth availability ────────────────────────────────────────────────
const btSupported = typeof navigator !== "undefined" && "bluetooth" in navigator;

// ── Decode raw BLE bytes to EPC hex string ────────────────────────────────────
function decodeEpc(value: DataView): string {
  const bytes = new Uint8Array(value.buffer);
  // Some readers prefix with length byte — strip if first byte = remaining length
  const start = bytes.length > 0 && bytes[0] === bytes.length - 1 ? 1 : 0;
  return Array.from(bytes.slice(start))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function RfidScan() {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";

  // ── BLE state ─────────────────────────────────────────────────────────────
  const deviceRef  = useRef<BluetoothDevice | null>(null);
  const charRef    = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const [connState,   setConnState]   = useState<ConnState>("disconnected");
  const [deviceName,  setDeviceName]  = useState<string>("");
  const [gattServices, setGattServices] = useState<GattService[]>([]);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [savedDeviceName] = useState(() => localStorage.getItem("rfid_device_name") ?? "");

  // ── Session state ─────────────────────────────────────────────────────────
  const sessionRef    = useRef<Set<string>>(new Set());
  const [session,     setSession]     = useState<SessionEntry[]>([]);
  const [scanning,    setScanning]    = useState(false);
  const [actionMode,  setActionMode]  = useState<ActionMode>("none");
  const [locationId,  setLocationId]  = useState<number | null>(null);
  const [locations,   setLocations]   = useState<LocationOption[]>([]);
  const [quantityEach, setQuantityEach] = useState(1);
  const [actionNote,  setActionNote]  = useState("");
  const [submitting,  setSubmitting]  = useState(false);

  // HID fallback input
  const inputRef    = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [epcInput,  setEpcInput]  = useState("");

  useEffect(() => {
    apiClient.get("/locations").then((r) => {
      const data = r.data?.items ?? r.data ?? [];
      setLocations(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, []);

  // ── EPC resolution (shared by BLE + HID paths) ───────────────────────────
  const resolveEpc = useCallback(async (raw: string) => {
    const epc = raw.trim().toUpperCase();
    if (!epc || sessionRef.current.has(epc)) return;
    sessionRef.current.add(epc);
    setScanning(true);
    try {
      const result = await rfidApi.scanEpc(epc);
      setSession((prev) => [...prev, { epc, item: result.item, selected: true }]);
      if (result.found && result.item) {
        toast.success(`Found: ${result.item.name}`, { duration: 1500 });
      } else {
        toast(`Unknown EPC: ${epc.slice(0, 8)}…`, { icon: "⚠️", duration: 2000 });
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

  // ── BLE notification handler ──────────────────────────────────────────────
  const onBleNotify = useCallback((event: Event) => {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    if (!char.value) return;
    const raw = decodeEpc(char.value);
    // Only process 24-char hex (96-bit EPC) or ASCII hex string
    const hex = raw.replace(/[^0-9A-F]/gi, "");
    if (hex.length >= 20) resolveEpc(hex.slice(0, 24));
  }, [resolveEpc]);

  // ── Connect to RP902 via Web Bluetooth ───────────────────────────────────
  const connectBle = async () => {
    if (!btSupported) {
      toast.error("Web Bluetooth not supported — use Chrome or Edge");
      return;
    }
    setConnState("connecting");
    setGattServices([]);
    try {
      const device = await (navigator as Navigator & { bluetooth: Bluetooth }).bluetooth.requestDevice({
        // Filter by name prefix so only RP902 devices appear in picker
        filters: [
          { namePrefix: "RP902" },
          { namePrefix: "Unitech" },
        ],
        // Request all services so we can discover UUIDs
        optionalServices: [
          UART_SERVICE,
          UNITECH_SERVICE,
          "battery_service",
          "device_information",
        ],
      });

      deviceRef.current = device;
      setDeviceName(device.name ?? "RP902");
      localStorage.setItem("rfid_device_name", device.name ?? "RP902");

      device.addEventListener("gattserverdisconnected", () => {
        setConnState("disconnected");
        charRef.current = null;
        toast("RP902 disconnected", { icon: "📡" });
      });

      const server = await device.gatt!.connect();

      // ── Discover all services for debugging ────────────────────────────
      let discovered: GattService[] = [];
      try {
        const services = await server.getPrimaryServices();
        for (const svc of services) {
          const chars = await svc.getCharacteristics().catch(() => []);
          discovered.push({ uuid: svc.uuid, chars: chars.map((c) => c.uuid) });
        }
        setGattServices(discovered);
      } catch { /* device may restrict full discovery */ }

      // ── Try known scan-data characteristics ───────────────────────────
      let scanChar: BluetoothRemoteGATTCharacteristic | null = null;

      // Try Nordic UART TX (device→app notifications)
      try {
        const svc = await server.getPrimaryService(UART_SERVICE);
        scanChar = await svc.getCharacteristic(UART_TX_CHAR);
      } catch { /* not UART */ }

      // Try Unitech proprietary service
      if (!scanChar) {
        try {
          const svc = await server.getPrimaryService(UNITECH_SERVICE);
          scanChar = await svc.getCharacteristic(UNITECH_NOTIFY);
        } catch { /* not Unitech proprietary */ }
      }

      if (scanChar) {
        await scanChar.startNotifications();
        scanChar.addEventListener("characteristicvaluechanged", onBleNotify);
        charRef.current = scanChar;
        setConnState("connected");
        toast.success(`Connected: ${device.name ?? "RP902"} — pull trigger to scan`);
      } else {
        // Connected but couldn't find scan characteristic — show discovery panel
        setConnState("connected");
        setShowDiscovery(true);
        toast("Connected — scan data service not found. Check Discovery panel below.", { icon: "🔍", duration: 6000 });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User cancelled")) {
        setConnState("disconnected");
      } else {
        setConnState("error");
        toast.error(`BLE error: ${msg}`);
      }
    }
  };

  const disconnectBle = () => {
    if (charRef.current) {
      charRef.current.removeEventListener("characteristicvaluechanged", onBleNotify);
      charRef.current = null;
    }
    deviceRef.current?.gatt?.disconnect();
    deviceRef.current = null;
    setConnState("disconnected");
    setDeviceName("");
    setGattServices([]);
  };

  // ── HID fallback handlers ─────────────────────────────────────────────────
  const handleHidChange = (value: string) => {
    setEpcInput(value);
    if (value.trim().length >= 24 && /^[0-9A-Fa-f]+$/.test(value.trim())) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => resolveEpc(value), 150);
    }
  };
  const handleHidKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      resolveEpc(epcInput);
    }
  };

  // ── Session helpers ───────────────────────────────────────────────────────
  const toggleSelect = (epc: string) =>
    setSession((prev) => prev.map((e) => e.epc === epc ? { ...e, selected: !e.selected } : e));

  const clearSession = () => {
    setSession([]);
    sessionRef.current.clear();
    setActionMode("none");
    setActionNote("");
  };

  const selectedItems   = session.filter((e) => e.selected && e.item !== null);
  const selectedItemIds = selectedItems.map((e) => e.item!.item_id);
  const matchedCount    = session.filter((e) => e.item !== null).length;
  const unknownCount    = session.filter((e) => e.item === null).length;

  const handleBatchAction = async () => {
    if (!locationId) { toast.error("Select a location first"); return; }
    if (selectedItemIds.length === 0) { toast.error("No items selected"); return; }
    setSubmitting(true);
    try {
      const base = { item_ids: selectedItemIds, location_id: locationId, quantity_each: quantityEach };
      const results = actionMode === "stock_in"
        ? await rfidApi.batchStockIn({ ...base, notes: actionNote || undefined })
        : await rfidApi.batchStockOut({ ...base, reason: actionNote || undefined });
      const ok     = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      if (ok.length)     toast.success(`${actionMode === "stock_in" ? "Stocked in" : "Stocked out"} ${ok.length} item(s)`);
      if (failed.length) toast.error(`${failed.length} failed: ${failed.map((f) => f.error).join("; ")}`);
      const successIds = new Set(ok.map((r) => r.item_id));
      setSession((prev) => prev.filter((e) => !e.item || !successIds.has(e.item.item_id)));
      ok.forEach((r) => {
        const entry = session.find((e) => e.item?.item_id === r.item_id);
        if (entry) sessionRef.current.delete(entry.epc);
      });
      setActionMode("none");
      setActionNote("");
    } catch { toast.error("Action failed"); }
    finally { setSubmitting(false); }
  };

  const glass: React.CSSProperties = {
    background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.75)",
    backdropFilter: "blur(12px)",
    border: "1px solid var(--border-card)",
    borderRadius: 16,
  };

  const itemStatus = (item: ResolvedRfidItem) =>
    item.total_quantity <= 0 ? "OUT" : item.total_quantity <= item.reorder_level ? "LOW" : "OK";

  const connColor = {
    disconnected: "var(--text-muted)",
    connecting:   "var(--accent-warning)",
    connected:    "var(--accent-success)",
    error:        "var(--accent-danger)",
  }[connState];

  const ConnIcon = connState === "connected" ? BluetoothConnected
    : connState === "connecting" ? Loader2
    : connState === "error" ? BluetoothOff
    : Bluetooth;

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
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Unitech RP902 · Web Bluetooth</p>
        </div>
        {scanning && <Loader2 size={16} className="animate-spin ml-auto" style={{ color: "var(--accent)" }} />}
      </div>

      {/* Bluetooth connection panel */}
      <div style={glass} className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <ConnIcon
            size={18}
            className={connState === "connecting" ? "animate-spin" : ""}
            style={{ color: connColor, flexShrink: 0 }}
          />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {connState === "connected"    ? `Connected: ${deviceName}`
               : connState === "connecting" ? "Connecting…"
               : connState === "error"      ? "Connection failed"
               : savedDeviceName           ? `Last device: ${savedDeviceName}`
               : "No device connected"}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {connState === "connected"
                ? charRef.current ? "Receiving scan events — pull trigger" : "Connected but scan service not found — see Discovery"
                : btSupported ? "Click Connect to open Bluetooth picker"
                : "Web Bluetooth not supported — use Chrome or Edge"}
            </p>
          </div>

          {connState === "connected" ? (
            <button onClick={disconnectBle}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: "rgba(220,38,38,0.10)", color: "var(--accent-danger)", border: "1px solid rgba(220,38,38,0.25)" }}>
              Disconnect
            </button>
          ) : (
            <button
              onClick={connectBle}
              disabled={!btSupported || connState === "connecting"}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40"
              style={{ background: "rgba(37,99,235,0.12)", color: "var(--accent)", border: "1px solid rgba(37,99,235,0.3)" }}>
              {connState === "connecting" ? "Connecting…" : "Connect RP902"}
            </button>
          )}
        </div>

        {!btSupported && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
            style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", color: "var(--accent-danger)" }}>
            <AlertCircle size={13} />
            Web Bluetooth requires Chrome or Edge. Safari and Firefox not supported.
          </div>
        )}

        {/* HID fallback — always visible, works even without BLE */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
            HID fallback — or type EPC manually:
          </p>
          <div className="relative">
            <input
              ref={inputRef}
              value={epcInput}
              onChange={(e) => handleHidChange(e.target.value)}
              onKeyDown={handleHidKeyDown}
              placeholder="EPC hex (24 chars) — RP902 HID mode types here"
              className="w-full px-4 py-2.5 rounded-xl text-xs font-mono"
              style={{
                background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.9)",
                border: "1px solid var(--border-card)",
                color: "var(--text-primary)",
                outline: "none",
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      {/* GATT Discovery panel — shown when connected but scan char not found */}
      {gattServices.length > 0 && (
        <div style={glass} className="p-4 space-y-3">
          <button
            onClick={() => setShowDiscovery((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}>
            <span>🔍 GATT Service Discovery ({gattServices.length} services found)</span>
            {showDiscovery ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showDiscovery && (
            <div className="space-y-2 text-xs font-mono max-h-64 overflow-y-auto pr-1">
              <p className="text-xs font-sans font-semibold" style={{ color: "var(--text-muted)" }}>
                Share this list with support to identify the scan data UUID:
              </p>
              {gattServices.map((svc) => (
                <div key={svc.uuid} className="p-2 rounded-lg space-y-1"
                  style={{ background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}>
                  <p style={{ color: "var(--accent)" }}>Service: {svc.uuid}</p>
                  {svc.chars.map((c) => (
                    <p key={c} style={{ color: "var(--text-muted)" }}>  └ Char: {c}</p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Session stats */}
      {session.length > 0 && (
        <div className="flex items-center gap-2">
          {matchedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: "rgba(5,150,105,0.12)", color: "var(--accent-success)" }}>
              {matchedCount} matched
            </span>
          )}
          {unknownCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: "rgba(220,38,38,0.10)", color: "var(--accent-danger)" }}>
              {unknownCount} unknown
            </span>
          )}
          <button onClick={clearSession}
            className="ml-auto flex items-center gap-1 text-xs hover:opacity-70"
            style={{ color: "var(--text-muted)" }}>
            <Trash2 size={12} /> Clear
          </button>
        </div>
      )}

      {/* Session list */}
      {session.length > 0 && (
        <div style={glass} className="p-4 space-y-2">
          <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Scanned ({session.length})
          </p>
          {session.map((entry) => (
            <button key={entry.epc}
              onClick={() => entry.item && toggleSelect(entry.epc)}
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left"
              style={{
                background: entry.selected && entry.item
                  ? isDark ? "rgba(37,99,235,0.15)" : "rgba(37,99,235,0.08)"
                  : isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.6)",
                border: entry.selected && entry.item
                  ? "1px solid rgba(37,99,235,0.4)" : "1px solid var(--border-card)",
                cursor: entry.item ? "pointer" : "default",
              }}>
              {entry.item ? (
                <>
                  <CheckCircle2 size={16} style={{ color: entry.selected ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{entry.item.name}</p>
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
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>Location</label>
                <select value={locationId ?? ""} onChange={(e) => setLocationId(Number(e.target.value) || null)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.9)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}>
                  <option value="">Select location…</option>
                  {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>Qty per item</label>
                <Input type="number" min={1} value={quantityEach}
                  onChange={(e) => setQuantityEach(Math.max(1, Number(e.target.value)))} />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  {actionMode === "stock_out" ? "Reason (optional)" : "Notes (optional)"}
                </label>
                <Input value={actionNote} onChange={(e) => setActionNote(e.target.value)}
                  placeholder={actionMode === "stock_out" ? "Checkout, damaged…" : "PO reference…"} />
              </div>
              <Button onClick={handleBatchAction}
                disabled={submitting || !locationId || selectedItemIds.length === 0}
                variant={actionMode === "stock_in" ? "primary" : "danger"}
                className="w-full">
                {submitting
                  ? <Loader2 size={16} className="animate-spin mr-2" />
                  : actionMode === "stock_in" ? <ArrowUpRight size={16} className="mr-2" /> : <ArrowDownRight size={16} className="mr-2" />}
                Confirm {actionMode === "stock_in" ? "Stock In" : "Stock Out"} ({selectedItemIds.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {session.length === 0 && (
        <div className="py-12 text-center space-y-3">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto"
            style={{ background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", border: "1px dashed var(--border-card)" }}>
            <Radio size={28} style={{ color: "var(--text-muted)" }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {connState === "connected" && charRef.current
              ? "Ready — pull RP902 trigger to scan"
              : "Connect RP902 above to start scanning"}
          </p>
          <p className="text-xs max-w-xs mx-auto leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Chrome/Edge required for Web Bluetooth. Use the HID fallback input if connecting via Bluetooth HID or USB mode.
          </p>
        </div>
      )}
    </div>
  );
}
