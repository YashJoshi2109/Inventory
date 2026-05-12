import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, QrCode, Printer, Barcode, Tag, ExternalLink } from "lucide-react";
import { itemsApi } from "@/api/items";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import { openOrDownloadBlob } from "@/utils/fileActions";

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

  const { data: barcodeUrl } = useQuery({
    queryKey: ["item-barcode-png", itemId],
    queryFn: async () => {
      const blob = await itemsApi.downloadBarcodePng(itemId);
      return URL.createObjectURL(blob);
    },
    enabled: Number.isFinite(itemId) && !!item,
    staleTime: Infinity,
  });

  const { data: qrUrl } = useQuery({
    queryKey: ["item-qr-png", itemId],
    queryFn: async () => {
      const blob = await itemsApi.downloadQrPng(itemId);
      return URL.createObjectURL(blob);
    },
    enabled: Number.isFinite(itemId) && !!item,
    staleTime: Infinity,
  });

  const { data: barcodeMeta } = useQuery({
    queryKey: ["item-barcode-meta", itemId],
    queryFn: () => itemsApi.getBarcodeMeta(itemId),
    enabled: Number.isFinite(itemId) && !!item,
    staleTime: Infinity,
  });

  const status = useMemo(() => {
    if (!item) return "OUT";
    if (item.total_quantity <= 0) return "OUT";
    if (item.total_quantity <= item.reorder_level) return "LOW";
    return "OK";
  }, [item]);

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-5 max-w-3xl">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8" rounded="xl" />
          <Skeleton className="h-5 w-48" rounded="md" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-4 w-32" rounded="md" />
            </div>
          ))}
        </div>
        <SkeletonCard rows={5} />
      </div>
    );
  }

  if (!item) {
    return <div className="p-6 text-red-400">Item not found.</div>;
  }

  const downloadQr = async () => {
    try {
      const blob = await itemsApi.downloadQrPng(item.id);
      await openOrDownloadBlob(blob, `${item.sku}-qr.png`);
    } catch {
      toast.error("Failed to load QR code");
    }
  };

  const downloadBarcode = async () => {
    try {
      const blob = await itemsApi.downloadBarcodePng(item.id);
      await openOrDownloadBlob(blob, `${item.sku}-barcode.png`);
    } catch {
      toast.error("Failed to load barcode");
    }
  };

  const printSingleLabelSheet = async () => {
    try {
      const blob = await itemsApi.printLabelSheet([item.id]);
      await openOrDownloadBlob(blob, `${item.sku}-labels.pdf`);
    } catch {
      toast.error("Failed to generate label sheet");
    }
  };

  const downloadZpl = async () => {
    try {
      const blob = await itemsApi.downloadItemZpl(item.id);
      await openOrDownloadBlob(blob, `${item.sku}-label.zpl`);
      toast.success("ZPL downloaded — paste into labelary.com to preview or Zebra printer to print");
    } catch {
      toast.error("Failed to generate ZPL");
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
              onClick={downloadBarcode}
            >
              Barcode
            </Button>
            <Button
              variant="secondary"
              leftIcon={<QrCode size={14} />}
              onClick={downloadQr}
            >
              QR Code
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

      {/* ── Barcode & QR Preview ── */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Barcode &amp; QR Code</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 text-center">Code 128</p>
            <div className="bg-white rounded-xl p-3 flex items-center justify-center min-h-[72px]">
              {barcodeUrl
                ? <img src={barcodeUrl} alt="Code128 barcode" className="max-h-14 w-full object-contain" />
                : <Skeleton className="h-12 w-full" rounded="lg" />}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 text-center">GS1 QR Code</p>
            <div className="bg-white rounded-xl p-3 flex items-center justify-center min-h-[72px]">
              {qrUrl
                ? <img src={qrUrl} alt="GS1 QR code" className="max-h-14 w-full object-contain" />
                : <Skeleton className="h-12 w-full" rounded="lg" />}
            </div>
          </div>
        </div>
        {barcodeMeta && (
          <div className="mt-3 rounded-lg border border-surface-border/50 bg-surface-hover/10 divide-y divide-surface-border/30">
            {[
              { label: "GTIN-14", value: barcodeMeta.gtin14 },
              { label: "Serial", value: barcodeMeta.serial },
              { label: "EPC (SGTIN-96)", value: barcodeMeta.epc_hex },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-3 py-1.5 gap-3">
                <span className="text-[10px] uppercase tracking-widest text-slate-400 shrink-0">{label}</span>
                <span className="text-xs font-mono text-slate-200 break-all text-right">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* ZPL / Zebra download */}
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            leftIcon={<Tag size={13} />}
            onClick={downloadZpl}
            className="flex-1"
          >
            Download ZPL (Zebra)
          </Button>
          <a
            href="https://labelary.com/viewer.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all hover:opacity-80 shrink-0"
            style={{ border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
            title="Preview ZPL on labelary.com"
          >
            <ExternalLink size={12} />
            Preview
          </a>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Rack-wise Stock</h3>
        {loadingLevels ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" rounded="xl" />
            ))}
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
