import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { itemsApi } from "@/api/items";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard, Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { MapPin, ChevronDown, QrCode, Download, X, LayoutGrid, List, Camera } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { clsx } from "clsx";
import type { Area, Location } from "@/types";

export function Locations() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [newArea, setNewArea] = useState({ code: "", name: "", building: "", floor: "" });
  const [newLocation, setNewLocation] = useState({ area_id: "", code: "", name: "", shelf: "", bin_label: "" });
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

  const { data: areas, isLoading } = useQuery<Area[]>({
    queryKey: ["areas"],
    queryFn: async () => {
      const { data } = await apiClient.get("/locations/areas");
      return data;
    },
  });

  const createAreaMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post("/locations/areas", {
        code: newArea.code,
        name: newArea.name,
        building: newArea.building || undefined,
        floor: newArea.floor || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Area created");
      setShowAreaModal(false);
      setNewArea({ code: "", name: "", building: "", floor: "" });
      queryClient.invalidateQueries({ queryKey: ["areas"] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to create area");
    },
  });

  const createLocationMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post("/locations", {
        area_id: Number(newLocation.area_id),
        code: newLocation.code,
        name: newLocation.name,
        shelf: newLocation.shelf || undefined,
        bin_label: newLocation.bin_label || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Rack created with barcode");
      setShowLocationModal(false);
      setNewLocation({ area_id: "", code: "", name: "", shelf: "", bin_label: "" });
      queryClient.invalidateQueries({ queryKey: ["areas"] });
      queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Failed to create rack");
    },
  });

  if (isLoading) return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28" rounded="md" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" rounded="xl" />
          <Skeleton className="h-9 w-28" rounded="xl" />
        </div>
      </div>
      <SkeletonCard rows={6} />
      <SkeletonCard rows={4} />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,rgba(8,145,178,0.25),rgba(34,211,238,0.12))", border: "1px solid rgba(34,211,238,0.2)" }}>
            <MapPin size={16} className="text-brand-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Lab Locations</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {areas?.length ?? 0} areas · {areas?.reduce((s, a) => s + a.location_count, 0) ?? 0} racks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Smart scan CTA */}
          <button
            onClick={() => navigate("/smart-scan")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all hover:scale-[1.02]"
            style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", color: "#c084fc" }}>
            <Camera size={13} /> Audit with AI
          </button>

          {/* View toggle */}
          <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
            <button onClick={() => setViewMode("list")}
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs transition-all"
              style={viewMode === "list"
                ? { background: "rgba(34,211,238,0.12)", color: "#22d3ee" }
                : { background: "var(--bg-card)", color: "var(--text-muted)" }}>
              <List size={13} />
            </button>
            <button onClick={() => setViewMode("map")}
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs transition-all"
              style={viewMode === "map"
                ? { background: "rgba(34,211,238,0.12)", color: "#22d3ee" }
                : { background: "var(--bg-card)", color: "var(--text-muted)" }}>
              <LayoutGrid size={13} />
            </button>
          </div>

          <Button variant="secondary" size="sm" onClick={() => setShowAreaModal(true)}>+ Area</Button>
          <Button variant="primary" size="sm" onClick={() => setShowLocationModal(true)}>+ Rack</Button>
        </div>
      </div>

      {!areas?.length ? (
        <EmptyState icon={<MapPin size={40} />} title="No locations yet" description="Add areas and bins to start scanning" />
      ) : viewMode === "map" ? (
        <RackMapView areas={areas} />
      ) : (
        <div className="space-y-3">
          {areas.map((area) => <AreaCard key={area.id} area={area} />)}
        </div>
      )}

      <Modal
        open={showAreaModal}
        onClose={() => setShowAreaModal(false)}
        title="Create Area"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowAreaModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={createAreaMutation.isPending}
              disabled={!newArea.code.trim() || !newArea.name.trim()}
              onClick={() => createAreaMutation.mutate()}
            >
              Create Area
            </Button>
          </div>
        )}
      >
        <div className="p-5 space-y-3">
          <Input
            label="Area Code"
            value={newArea.code}
            onChange={(e) => setNewArea((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
            placeholder="CHEM-A"
          />
          <Input
            label="Area Name"
            value={newArea.name}
            onChange={(e) => setNewArea((p) => ({ ...p, name: e.target.value }))}
            placeholder="Chemicals Storage"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Building (optional)"
              value={newArea.building}
              onChange={(e) => setNewArea((p) => ({ ...p, building: e.target.value }))}
            />
            <Input
              label="Floor (optional)"
              value={newArea.floor}
              onChange={(e) => setNewArea((p) => ({ ...p, floor: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        title="Create Rack / Bin"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowLocationModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={createLocationMutation.isPending}
              disabled={!newLocation.area_id || !newLocation.code.trim() || !newLocation.name.trim()}
              onClick={() => createLocationMutation.mutate()}
            >
              Create Rack
            </Button>
          </div>
        )}
      >
        <div className="p-5 space-y-3">
          <label className="block text-sm" style={{ color: "var(--text-primary)" }}>
            Area
            <select
              value={newLocation.area_id}
              onChange={(e) => setNewLocation((p) => ({ ...p, area_id: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{ color: "var(--text-primary)" }}
            >
              <option value="">Select area</option>
              {areas?.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.code} - {area.name}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Rack Code"
            value={newLocation.code}
            onChange={(e) => setNewLocation((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
            placeholder="A1-BIN-04"
          />
          <Input
            label="Rack Name"
            value={newLocation.name}
            onChange={(e) => setNewLocation((p) => ({ ...p, name: e.target.value }))}
            placeholder="Shelf A1 Bin 04"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Shelf (optional)"
              value={newLocation.shelf}
              onChange={(e) => setNewLocation((p) => ({ ...p, shelf: e.target.value }))}
            />
            <Input
              label="Bin Label (optional)"
              value={newLocation.bin_label}
              onChange={(e) => setNewLocation((p) => ({ ...p, bin_label: e.target.value }))}
            />
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            A location barcode is auto-generated as <span className="font-mono">LOC:RACK_CODE</span>.
          </p>
        </div>
      </Modal>
    </div>
  );
}

interface LocationModal {
  barcodeUrl: string;
  gs1QrUrl: string;
  name: string;
  code: string;
  locId: number;
  meta: { gln13: string; epc_hex: string; code128_value: string; gs1_url: string } | null;
}

function AreaCard({ area }: { area: Area }) {
  const [expanded, setExpanded] = useState(false);
  const [locModal, setLocModal] = useState<LocationModal | null>(null);

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["locations", area.id],
    queryFn: async () => {
      const { data } = await apiClient.get("/locations", { params: { area_id: area.id } });
      return data;
    },
    enabled: expanded,
  });

  const closeModal = () => {
    if (locModal) {
      URL.revokeObjectURL(locModal.barcodeUrl);
      URL.revokeObjectURL(locModal.gs1QrUrl);
      setLocModal(null);
    }
  };

  const openLocModal = async (loc: Location) => {
    try {
      const [barcodeBlob, gs1Blob, meta] = await Promise.all([
        itemsApi.downloadLocationQrPng(loc.id),     // Code128 barcode (LOC:CODE)
        itemsApi.downloadLocationGs1QrPng(loc.id),  // GS1 Digital Link QR
        itemsApi.getLocationBarcodeMeta(loc.id),
      ]);
      setLocModal({
        barcodeUrl: URL.createObjectURL(barcodeBlob),
        gs1QrUrl: URL.createObjectURL(gs1Blob),
        name: loc.name,
        code: loc.code,
        locId: loc.id,
        meta,
      });
    } catch {
      toast.error("Failed to load location labels");
    }
  };

  return (
    <Card>
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="w-9 h-9 bg-brand-600/20 rounded-lg flex items-center justify-center shrink-0">
          <MapPin size={16} className="text-brand-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-brand-400">{area.code}</span>
            {!area.is_active && <Badge variant="warning" className="text-xs">Inactive</Badge>}
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{area.name}</p>
          {area.building && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{area.building}{area.floor ? ` · Floor ${area.floor}` : ""}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="default">{area.location_count} bins</Badge>
          <ChevronDown size={16} className={clsx("text-slate-400 transition-transform", expanded && "rotate-180")} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-surface-border">
          {!locations ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" rounded="xl" />
              ))}
            </div>
          ) : locations.length === 0 ? (
            <p className="text-center py-4 text-sm" style={{ color: "var(--text-muted)" }}>No bins in this area</p>
          ) : (
            <div className="divide-y divide-surface-border/40">
              {locations.map((loc) => (
                <div key={loc.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>{loc.code}</span>
                      {loc.shelf && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Shelf {loc.shelf}</span>}
                    </div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>{loc.name}</p>
                  </div>
                  <button
                    onClick={() => openLocModal(loc)}
                    className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors" style={{ color: "var(--text-secondary)" }}
                    title="View barcode & QR label"
                  >
                    <QrCode size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Location label modal — barcode + QR + EPC ────────────────────── */}
      {locModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={closeModal}>
          <div
            className="relative flex flex-col gap-4 p-6 rounded-2xl shadow-2xl w-full max-w-sm"
            style={{ background: "var(--bg-topbar)", border: "1px solid var(--border-card)" }}
            onClick={e => e.stopPropagation()}>
            {/* Close */}
            <button
              onClick={closeModal}
              className="absolute top-3 right-3 text-slate-600 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-white/5">
              <X size={16} />
            </button>

            <div>
              <div className="flex items-center gap-2">
                <QrCode size={15} className="text-brand-400" />
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{locModal.name}</p>
              </div>
              <p className="text-xs font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>{locModal.code}</p>
            </div>

            {/* Both images side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-[10px] uppercase tracking-widest text-center" style={{ color: "var(--text-muted)" }}>Code 128</p>
                <div className="bg-white rounded-xl p-2 flex items-center justify-center">
                  <img src={locModal.barcodeUrl} alt="Code128" className="max-h-20 w-full object-contain" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-[10px] uppercase tracking-widest text-center" style={{ color: "var(--text-muted)" }}>GS1 QR</p>
                <div className="bg-white rounded-xl p-2 flex items-center justify-center">
                  <img src={locModal.gs1QrUrl} alt="GS1 QR" className="max-h-20 w-full object-contain" />
                </div>
              </div>
            </div>

            {/* EPC + GLN identifiers */}
            {locModal.meta && (
              <div className="rounded-lg border divide-y text-xs font-mono"
                style={{ borderColor: "var(--border-card)", borderWidth: 1 }}>
                {[
                  { label: "GLN-13", value: locModal.meta.gln13 },
                  { label: "Code128", value: locModal.meta.code128_value },
                  { label: "EPC (SGLN-96)", value: locModal.meta.epc_hex },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start justify-between gap-2 px-3 py-1.5">
                    <span className="text-[10px] uppercase tracking-widest shrink-0" style={{ color: "var(--text-muted)" }}>{label}</span>
                    <span className="break-all text-right" style={{ color: "var(--text-primary)" }}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Download buttons */}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={locModal.barcodeUrl}
                download={`barcode_${locModal.code}.png`}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium"
                style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)", color: "#22d3ee" }}>
                <Download size={12} /> Barcode
              </a>
              <a
                href={locModal.gs1QrUrl}
                download={`qr_${locModal.code}.png`}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium"
                style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.2)", color: "#22d3ee" }}>
                <Download size={12} /> QR Code
              </a>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Visual Rack Map ────────────────────────────────────────────────────────────

function RackMapView({ areas }: { areas: Area[] }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {areas.map((area) => <AreaMapSection key={area.id} area={area} />)}
    </div>
  );
}

function AreaMapSection({ area }: { area: Area }) {
  const { data: locations } = useQuery<Location[]>({
    queryKey: ["locations", area.id],
    queryFn: async () => {
      const { data } = await apiClient.get("/locations", { params: { area_id: area.id } });
      return data;
    },
  });

  const RACK_COLORS = [
    { bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.2)", text: "#34d399" },
    { bg: "rgba(34,211,238,0.08)", border: "rgba(34,211,238,0.2)", text: "#22d3ee" },
    { bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.2)", text: "#60a5fa" },
    { bg: "rgba(168,85,247,0.08)", border: "rgba(168,85,247,0.2)", text: "#c084fc" },
    { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.2)", text: "#fbbf24" },
  ];

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>

      {/* Area header */}
      <div className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-card)", background: "rgba(34,211,238,0.02)" }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.18)" }}>
          <MapPin size={13} className="text-brand-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{area.name}</p>
          <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            {area.code}
            {area.building ? ` · ${area.building}` : ""}
            {area.floor ? ` F${area.floor}` : ""}
          </p>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg"
          style={{ background: "rgba(34,211,238,0.08)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.15)" }}>
          {area.location_count} racks
        </span>
      </div>

      {/* Rack grid */}
      <div className="p-3 grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 gap-2 min-h-[80px]">
        {!locations ? (
          Array.from({ length: Math.min(area.location_count || 4, 10) }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl animate-pulse"
              style={{ background: "var(--bg-card)" }} />
          ))
        ) : locations.length === 0 ? (
          <div className="col-span-full flex items-center justify-center py-6 text-xs" style={{ color: "var(--text-muted)" }}>
            No racks — add one above
          </div>
        ) : (
          locations.map((loc, idx) => {
            const c = RACK_COLORS[idx % RACK_COLORS.length];
            return (
              <div key={loc.id}
                className="flex flex-col items-center justify-center gap-0.5 h-16 rounded-xl cursor-pointer transition-all duration-150 hover:scale-105"
                style={{ background: c.bg, border: `1px solid ${c.border}` }}
                title={`${loc.code} — ${loc.name}`}>
                <span className="text-[11px] font-mono font-bold leading-none" style={{ color: c.text }}>
                  {loc.code.length > 6 ? loc.code.slice(-5) : loc.code}
                </span>
                <span className="text-[8px] text-slate-600 text-center leading-snug px-1 truncate max-w-full">
                  {loc.name.length > 10 ? loc.name.slice(0, 9) + "…" : loc.name}
                </span>
                {loc.shelf && (
                  <span className="text-[7px] text-slate-700 font-mono">S{loc.shelf}</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
