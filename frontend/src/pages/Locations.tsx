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
import { MapPin, ChevronDown, QrCode } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { clsx } from "clsx";
import type { Area, Location } from "@/types";

export function Locations() {
  const queryClient = useQueryClient();
  const [showAreaModal, setShowAreaModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [newArea, setNewArea] = useState({ code: "", name: "", building: "", floor: "" });
  const [newLocation, setNewLocation] = useState({ area_id: "", code: "", name: "", shelf: "", bin_label: "" });

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Locations</h2>
          <p className="text-xs text-slate-500">{areas?.length ?? 0} areas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowAreaModal(true)}>
            Add Area
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowLocationModal(true)}>
            Add Rack
          </Button>
        </div>
      </div>

      {!areas?.length ? (
        <EmptyState icon={<MapPin size={40} />} title="No locations yet" description="Add areas and bins to start scanning" />
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
          <label className="block text-sm text-slate-300">
            Area
            <select
              value={newLocation.area_id}
              onChange={(e) => setNewLocation((p) => ({ ...p, area_id: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
          <p className="text-xs text-slate-500">
            A location barcode is auto-generated as <span className="font-mono">LOC:RACK_CODE</span>.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function AreaCard({ area }: { area: Area }) {
  const [expanded, setExpanded] = useState(false);

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["locations", area.id],
    queryFn: async () => {
      const { data } = await apiClient.get("/locations", { params: { area_id: area.id } });
      return data;
    },
    enabled: expanded,
  });

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
          <p className="text-sm font-medium text-slate-200">{area.name}</p>
          {area.building && <p className="text-xs text-slate-500">{area.building}{area.floor ? ` · Floor ${area.floor}` : ""}</p>}
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
            <p className="text-center py-4 text-sm text-slate-500">No bins in this area</p>
          ) : (
            <div className="divide-y divide-surface-border/40">
              {locations.map((loc) => (
                <div key={loc.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{loc.code}</span>
                      {loc.shelf && <span className="text-xs text-slate-500">Shelf {loc.shelf}</span>}
                    </div>
                    <p className="text-sm text-slate-300">{loc.name}</p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const blob = await itemsApi.downloadLocationQrPng(loc.id);
                        const url = URL.createObjectURL(blob);
                        window.open(url, "_blank", "noopener,noreferrer");
                        setTimeout(() => URL.revokeObjectURL(url), 60_000);
                      } catch {
                        toast.error("Failed to load QR code");
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-surface-hover text-slate-400 hover:text-white transition-colors"
                    title="Download QR label"
                  >
                    <QrCode size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
