import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { MapPin, ChevronDown, QrCode } from "lucide-react";
import { useState } from "react";
import { clsx } from "clsx";
import type { Area, Location } from "@/types";

export function Locations() {
  const { data: areas, isLoading } = useQuery<Area[]>({
    queryKey: ["areas"],
    queryFn: async () => {
      const { data } = await apiClient.get("/locations/areas");
      return data;
    },
  });

  if (isLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Locations</h2>
          <p className="text-xs text-slate-500">{areas?.length ?? 0} areas</p>
        </div>
      </div>

      {!areas?.length ? (
        <EmptyState icon={<MapPin size={40} />} title="No locations yet" description="Add areas and bins to start scanning" />
      ) : (
        <div className="space-y-3">
          {areas.map((area) => <AreaCard key={area.id} area={area} />)}
        </div>
      )}
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
            <div className="flex justify-center py-4"><Spinner size="sm" /></div>
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
                  <a
                    href={`/api/v1/barcodes/location/${loc.id}/qr/png`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg hover:bg-surface-hover text-slate-400 hover:text-white transition-colors"
                    title="Download QR label"
                  >
                    <QrCode size={15} />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
