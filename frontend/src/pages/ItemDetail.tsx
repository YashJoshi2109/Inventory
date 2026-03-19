import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Barcode, QrCode, Printer } from "lucide-react";
import { itemsApi } from "@/api/items";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export function ItemDetail() {
  const params = useParams();
  const itemId = Number(params.id);

  const { data: item, isLoading } = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => itemsApi.get(itemId),
    enabled: Number.isFinite(itemId),
  });

  const { data: levels, isLoading: loadingLevels } = useQuery({
    queryKey: ["item-levels", itemId],
    queryFn: () => itemsApi.getStockLevels(itemId),
    enabled: Number.isFinite(itemId),
  });

  const status = useMemo(() => {
    if (!item) return "OUT";
    if (item.total_quantity <= 0) return "OUT";
    if (item.total_quantity <= item.reorder_level) return "LOW";
    return "OK";
  }, [item]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!item) {
    return <div className="p-6 text-red-400">Item not found.</div>;
  }

  const openImage = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const printSingleLabelSheet = async () => {
    try {
      const blob = await itemsApi.printLabelSheet([item.id]);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error("Failed to generate label sheet");
    }
  };

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4 animate-fade-in">
      <Link to="/inventory" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft size={14} />
        Back to inventory
      </Link>

      <Card className="p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-brand-400">{item.sku}</p>
            <h2 className="text-xl font-semibold text-slate-100 mt-1">{item.name}</h2>
            <p className="text-sm text-slate-400 mt-1">{item.description || "No description"}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant="default">{item.category?.name || "Uncategorized"}</Badge>
              <Badge variant={status === "OUT" ? "danger" : status === "LOW" ? "warning" : "success"}>
                {status}
              </Badge>
              <Badge variant="info">
                {item.total_quantity} {item.unit} total
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              variant="secondary"
              leftIcon={<Barcode size={14} />}
              onClick={() => openImage(itemsApi.getBarcodePng(item.id))}
            >
              Item Barcode
            </Button>
            <Button
              variant="secondary"
              leftIcon={<QrCode size={14} />}
              onClick={() => openImage(itemsApi.getQrPng(item.id))}
            >
              Item QR
            </Button>
            <Button
              variant="primary"
              leftIcon={<Printer size={14} />}
              onClick={printSingleLabelSheet}
            >
              Print Label
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Rack-wise Stock</h3>
        {loadingLevels ? (
          <div className="flex justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : !levels?.length ? (
          <p className="text-sm text-slate-500">No stock in any rack yet.</p>
        ) : (
          <div className="space-y-2">
            {levels.map((level) => (
              <div
                key={level.id}
                className="flex items-center justify-between rounded-lg border border-surface-border/60 bg-surface-hover/20 px-3 py-2"
              >
                <div>
                  <p className="text-sm text-slate-200">
                    {level.location_name} <span className="font-mono text-xs text-slate-400">({level.location_code})</span>
                  </p>
                  <p className="text-xs text-slate-500">Last event: {new Date(level.last_event_at).toLocaleString()}</p>
                </div>
                <Badge variant={level.quantity <= 0 ? "danger" : "success"}>
                  {level.quantity} {item.unit}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
