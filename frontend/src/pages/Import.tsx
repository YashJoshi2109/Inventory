import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import toast from "react-hot-toast";
import { FileSpreadsheet, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { clsx } from "clsx";
import { apiClient } from "@/api/client";

interface ImportJob {
  id: number;
  filename: string;
  status: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  error_rows: number;
  errors: string | null;
}

export function Import() {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: jobs, isLoading } = useQuery<ImportJob[]>({
    queryKey: ["import-jobs"],
    queryFn: async () => {
      const { data } = await apiClient.get("/imports/jobs");
      return data;
    },
    refetchInterval: 5000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const endpoint = file.name.toLowerCase().endsWith(".csv") ? "/imports/csv" : "/imports/excel";
      const { data } = await apiClient.post(endpoint, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data as ImportJob;
    },
    onSuccess: (job) => {
      toast.success(`Import started: ${job.filename}`);
      queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? err.response?.data?.detail : "Upload failed";
      toast.error(typeof msg === "string" ? msg : "Upload failed");
    },
  });

  const handleFile = (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error("Only .xlsx, .xls, and .csv files are supported");
      return;
    }
    uploadMutation.mutate(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-6 animate-fade-in max-w-2xl">
      {/* Upload zone */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Import Inventory Data</h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Supports the legacy Lab_Inventory_Barcode_System.xlsx format and generic CSV
          </p>
        </CardHeader>
        <CardContent>
          <div
            className={clsx(
              "border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer",
              dragging
                ? "border-brand-500 bg-brand-500/10"
                : "border-surface-border hover:border-slate-500 hover:bg-surface-hover/30"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <FileSpreadsheet
              size={40}
              className={clsx("mx-auto mb-3", dragging ? "text-brand-400" : "text-slate-500")}
            />
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {uploadMutation.isPending ? "Uploading…" : "Drop file here or click to browse"}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>.xlsx, .xls, or .csv up to 50 MB</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </CardContent>
      </Card>

      {/* Migration guide */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Migration Guide</h3>
        </CardHeader>
        <CardContent className="space-y-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          <div className="space-y-2">
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>Supported Excel sheets:</p>
            <ul className="space-y-1 text-xs list-disc list-inside ml-2">
              <li><span className="font-mono text-brand-400">Items_Master</span> — SKU, Description, Category, Unit Cost, Reorder Level, Loc Bins</li>
              <li><span className="font-mono text-brand-400">Transactions</span> — Date, Type (IN/OUT), SKU, Qty, Location, Notes</li>
            </ul>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Items with duplicate SKUs are updated rather than duplicated. Locations are auto-created from bin labels.
            Transaction history is preserved and imported into the TimescaleDB audit ledger.
          </p>
        </CardContent>
      </Card>

      {/* Recent import jobs */}
      {jobs && jobs.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Recent Imports</h3>
          </CardHeader>
          <div className="divide-y divide-surface-border/50">
            {jobs.map((job) => (
              <ImportJobRow key={job.id} job={job} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ImportJobRow({ job }: { job: ImportJob }) {
  const statusConfig = {
    done: { icon: CheckCircle2, color: "text-emerald-400", label: "Done" },
    processing: { icon: Clock, color: "text-brand-400", label: "Processing" },
    pending: { icon: Clock, color: "text-slate-400", label: "Pending" },
    failed: { icon: XCircle, color: "text-red-400", label: "Failed" },
  }[job.status] ?? { icon: AlertTriangle, color: "text-amber-400", label: job.status };

  const StatusIcon = statusConfig.icon;

  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <StatusIcon size={18} className={clsx("shrink-0", statusConfig.color)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{job.filename}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {job.imported_rows} imported · {job.skipped_rows} skipped · {job.error_rows} errors
        </p>
      </div>
      <Badge
        variant={job.status === "done" ? "success" : job.status === "failed" ? "danger" : "info"}
      >
        {statusConfig.label}
      </Badge>
    </div>
  );
}
