import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import toast from "react-hot-toast";
import {
  FileSpreadsheet, CheckCircle2, XCircle, Clock, AlertTriangle,
  Upload, Download, ChevronDown, ChevronUp, RefreshCw, Eye, Edit3,
  Table, ArrowLeft, Send, Plus, Trash2, ShieldCheck, Info, X,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

// ── CSV helpers ──────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === "," && !inQuote) {
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  return lines.map(parseCSVLine);
}

function serializeCSV(rows: string[][]): string {
  return rows.map(row =>
    row.map(cell => {
      const s = String(cell);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  ).join("\n");
}

// ── Column schema ─────────────────────────────────────────────────────────────

const REQUIRED_COLUMNS = ["SKU", "Description"] as const;
const OPTIONAL_COLUMNS = ["Category", "Unit Cost", "Reorder Level", "Lead Time (days)", "Loc1 Bin", "Loc2 Bin", "Loc3 Bin", "Barcode Text (SKU)"] as const;
const ALL_EXPECTED_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

interface ValidationResult {
  valid: boolean;
  missingRequired: string[];
  missingOptional: string[];
  sanitizedCount: number;       // cells auto-filled with N/A
  emptySkuRows: number[];       // 1-based data row numbers with empty SKU
  dupSkus: string[];            // SKU values that appear more than once
  totalRows: number;
}

/** Normalise a header string for comparison (trim + lowercase) */
const normHeader = (s: string) => s.trim().toLowerCase();

function validateHeaders(headers: string[]): { missingRequired: string[]; missingOptional: string[] } {
  const normHeaders = headers.map(normHeader);
  const missingRequired = REQUIRED_COLUMNS.filter(
    col => !normHeaders.includes(normHeader(col))
  );
  const missingOptional = OPTIONAL_COLUMNS.filter(
    col => !normHeaders.includes(normHeader(col))
  );
  return { missingRequired, missingOptional };
}

/**
 * Sanitize rows in-place:
 * - Trim whitespace
 * - Replace blank / whitespace-only cells with "N/A"
 * Returns count of cells that were filled with N/A.
 */
function sanitizeRows(rows: string[][]): number {
  let count = 0;
  // rows[0] is the header row — don't sanitize it
  for (let ri = 1; ri < rows.length; ri++) {
    for (let ci = 0; ci < rows[ri].length; ci++) {
      const trimmed = (rows[ri][ci] ?? "").trim();
      if (trimmed === "" || trimmed === "-" || trimmed === "N/a" || trimmed === "n/a") {
        rows[ri][ci] = "N/A";
        count++;
      } else {
        rows[ri][ci] = trimmed;
      }
    }
  }
  return count;
}

function validateRows(rows: string[][]): Pick<ValidationResult, "emptySkuRows" | "dupSkus"> {
  if (rows.length < 2) return { emptySkuRows: [], dupSkus: [] };
  const headers = rows[0].map(normHeader);
  const skuIdx = headers.indexOf(normHeader("SKU"));
  if (skuIdx === -1) return { emptySkuRows: [], dupSkus: [] };

  const emptySkuRows: number[] = [];
  const seen = new Map<string, number>();
  const dupSkus: string[] = [];

  for (let ri = 1; ri < rows.length; ri++) {
    const sku = (rows[ri][skuIdx] ?? "").trim();
    if (!sku || sku === "N/A") {
      emptySkuRows.push(ri); // 1-based data row = ri
    } else {
      const prev = seen.get(sku.toUpperCase());
      if (prev !== undefined) {
        if (!dupSkus.includes(sku)) dupSkus.push(sku);
      }
      seen.set(sku.toUpperCase(), ri);
    }
  }
  return { emptySkuRows, dupSkus };
}

// ── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmImportModal({
  validation,
  filename,
  onConfirm,
  onCancel,
  loading,
}: {
  validation: ValidationResult;
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const dataRows = validation.totalRows;
  const hasIssues = validation.sanitizedCount > 0 || validation.emptySkuRows.length > 0 || validation.dupSkus.length > 0;
  const isBlocked = validation.emptySkuRows.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-card)" }}>
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={18} style={{ color: "var(--accent-success)" }} />
            <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
              Confirm Import
            </h2>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Summary */}
          <div className="rounded-xl p-3 space-y-2"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Import Summary
            </p>
            <div className="space-y-1.5">
              {[
                { label: "File", value: filename, color: "var(--text-primary)" },
                { label: "Data rows", value: dataRows, color: "var(--accent)" },
                { label: "Sanitized cells (→ N/A)", value: validation.sanitizedCount, color: validation.sanitizedCount > 0 ? "var(--accent-warning)" : "var(--accent-success)" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span style={{ color: "var(--text-secondary)" }}>{label}</span>
                  <span className="font-bold" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Warnings / Issues */}
          {hasIssues && (
            <div className="space-y-2">
              {validation.sanitizedCount > 0 && (
                <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
                  style={{ background: "rgba(var(--accent-warning-rgb), 0.08)", border: "1px solid rgba(var(--accent-warning-rgb), 0.25)" }}>
                  <Info size={13} className="shrink-0 mt-0.5" style={{ color: "var(--accent-warning)" }} />
                  <span style={{ color: "var(--text-secondary)" }}>
                    <strong style={{ color: "var(--accent-warning)" }}>{validation.sanitizedCount} empty cell{validation.sanitizedCount !== 1 ? "s" : ""}</strong> were auto-filled with <code style={{ color: "var(--accent)" }}>N/A</code> before upload.
                  </span>
                </div>
              )}
              {validation.dupSkus.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
                  style={{ background: "rgba(var(--accent-warning-rgb), 0.08)", border: "1px solid rgba(var(--accent-warning-rgb), 0.25)" }}>
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "var(--accent-warning)" }} />
                  <span style={{ color: "var(--text-secondary)" }}>
                    <strong style={{ color: "var(--accent-warning)" }}>Duplicate SKUs:</strong>{" "}
                    {validation.dupSkus.slice(0, 5).join(", ")}
                    {validation.dupSkus.length > 5 && ` + ${validation.dupSkus.length - 5} more`}.
                    {" "}Last occurrence will win.
                  </span>
                </div>
              )}
              {isBlocked && (
                <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
                  style={{ background: "rgba(var(--accent-danger-rgb), 0.08)", border: "1px solid rgba(var(--accent-danger-rgb), 0.28)" }}>
                  <XCircle size={13} className="shrink-0 mt-0.5" style={{ color: "var(--accent-danger)" }} />
                  <span style={{ color: "var(--text-secondary)" }}>
                    <strong style={{ color: "var(--accent-danger)" }}>{validation.emptySkuRows.length} row{validation.emptySkuRows.length !== 1 ? "s" : ""}</strong> still have no SKU (shown with red border in preview). Fix or delete them before importing.
                  </span>
                </div>
              )}
            </div>
          )}

          {!hasIssues && (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
              style={{ background: "rgba(var(--accent-success-rgb), 0.08)", border: "1px solid rgba(var(--accent-success-rgb), 0.22)" }}>
              <CheckCircle2 size={13} style={{ color: "var(--accent-success)" }} />
              <span style={{ color: "var(--text-secondary)" }}>All rows look good — no issues found.</span>
            </div>
          )}

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Duplicate SKUs will <strong>update</strong> existing items. New SKUs will be created. This action cannot be undone.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2.5 px-5 py-4"
          style={{ borderTop: "1px solid var(--border-card)" }}>
          <Button variant="secondary" size="sm" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            leftIcon={loading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
            onClick={onConfirm}
            disabled={loading || isBlocked}
          >
            {loading ? "Importing…" : isBlocked ? "Fix Issues First" : `Import ${dataRows} Rows`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Template CSV ─────────────────────────────────────────────────────────────
const TEMPLATE_ITEMS_CSV = `SKU,Description,Category,Unit Cost,Reorder Level,Lead Time (days),Loc1 Bin,Loc2 Bin,Loc3 Bin,Barcode Text (SKU)
CHEM-001,Sodium Chloride 500g,Chemicals,12.50,5,7,SHELF-A1,,,CHEM-001
CONS-001,Nitrile Gloves (Box 100),Consumables,18.99,10,3,SHELF-B2,,,CONS-001
EQUIP-001,Micropipette 200µL,Equipment,249.00,2,14,CABINET-1,,,EQUIP-001
`;

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_ITEMS_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "inventory_import_template.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const MAX_PREVIEW_ROWS = 200;

// ── Component ─────────────────────────────────────────────────────────────────
export function Import() {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ filename: string; rows: string[][] } | null>(null);
  const [editedRows, setEditedRows] = useState<string[][]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: jobs, isLoading, refetch } = useQuery<ImportJob[]>({
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
      setPreview(null);
      setEditedRows([]);
      queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
    },
    onError: (err: unknown) => {
      const msg = axios.isAxiosError(err) ? err.response?.data?.detail : "Upload failed";
      toast.error(typeof msg === "string" ? msg : "Upload failed");
    },
  });

  const handleFile = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error("Only .xlsx, .xls, and .csv files are supported");
      return;
    }
    // CSV → parse, validate, sanitize, then show preview
    if (file.name.toLowerCase().endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const allRows = parseCSV(text);
        if (allRows.length === 0) { toast.error("CSV file is empty"); return; }

        const rows = allRows.slice(0, MAX_PREVIEW_ROWS + 1).map(r => [...r]);
        const headers = rows[0] ?? [];

        // 1. Validate column headers
        const { missingRequired, missingOptional } = validateHeaders(headers);
        if (missingRequired.length > 0) {
          toast.error(`Missing required columns: ${missingRequired.join(", ")}. Download the template for the correct format.`, { duration: 7000 });
          return;
        }

        // 2. Sanitize: fill empty cells with N/A (mutates rows)
        const sanitizedCount = sanitizeRows(rows);

        // 3. Validate row data
        const { emptySkuRows, dupSkus } = validateRows(rows);

        const vr: ValidationResult = {
          valid: missingRequired.length === 0 && emptySkuRows.length === 0,
          missingRequired,
          missingOptional,
          sanitizedCount,
          emptySkuRows,
          dupSkus,
          totalRows: rows.length - 1, // exclude header
        };

        setValidation(vr);
        setPreview({ filename: file.name, rows });
        setEditedRows(rows);

        if (missingOptional.length > 0) {
          toast(`Missing optional columns: ${missingOptional.slice(0,3).join(", ")}${missingOptional.length > 3 ? "…" : ""}. Defaults will be used.`, { icon: "ℹ️", duration: 5000 });
        }
        if (sanitizedCount > 0) {
          toast(`${sanitizedCount} empty cell${sanitizedCount !== 1 ? "s" : ""} auto-filled with N/A.`, { icon: "🔧", duration: 4000 });
        }
      };
      reader.readAsText(file);
    } else {
      // Excel → upload directly (can't parse in browser without xlsx lib)
      uploadMutation.mutate(file);
    }
  }, [uploadMutation]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const hasProcessing = jobs?.some((j) => j.status === "processing" || j.status === "pending");

  /** Re-validate edited rows (called when user clicks Import button) */
  const requestImport = () => {
    if (!preview || !editedRows.length) return;

    // Re-run sanitize + validate on current edited state
    const rows = editedRows.map(r => [...r]);
    const sanitizedCount = sanitizeRows(rows);
    const { emptySkuRows, dupSkus } = validateRows(rows);
    const { missingRequired, missingOptional } = validateHeaders(rows[0] ?? []);

    const vr: ValidationResult = {
      valid: missingRequired.length === 0 && emptySkuRows.length === 0,
      missingRequired,
      missingOptional,
      sanitizedCount,
      emptySkuRows,
      dupSkus,
      totalRows: rows.length - 1,
    };
    setEditedRows(rows); // update with re-sanitized values
    setValidation(vr);
    setShowConfirm(true);
  };

  const doUpload = () => {
    if (!preview || !editedRows.length) return;
    const csvText = serializeCSV(editedRows);
    const blob = new Blob([csvText], { type: "text/csv" });
    const file = new File([blob], preview.filename, { type: "text/csv" });
    uploadMutation.mutate(file);
    setShowConfirm(false);
  };

  const cancelPreview = () => {
    setPreview(null);
    setEditedRows([]);
    setValidation(null);
    setShowConfirm(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const updateCell = (row: number, col: number, val: string) => {
    setEditedRows(prev => {
      const next = prev.map(r => [...r]);
      next[row][col] = val;
      return next;
    });
  };

  const addRow = () => {
    if (!editedRows.length) return;
    const cols = editedRows[0].length;
    setEditedRows(prev => [...prev, Array(cols).fill("")]);
  };

  const deleteRow = (rowIdx: number) => {
    if (rowIdx === 0) return; // don't delete header
    setEditedRows(prev => prev.filter((_, i) => i !== rowIdx));
  };

  // ── Preview mode ─────────────────────────────────────────────────────────
  if (preview) {
    const headers = editedRows[0] ?? [];
    const dataRows = editedRows.slice(1);
    const isTruncated = preview.rows.length > MAX_PREVIEW_ROWS;
    const skuColIdx = headers.map(h => h.trim().toLowerCase()).indexOf("sku");
    const emptySkuSet = new Set(validation?.emptySkuRows ?? []);
    const hasBlockers = (validation?.emptySkuRows.length ?? 0) > 0;

    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6 space-y-4 animate-fade-in">

        {/* Confirmation modal */}
        {showConfirm && validation && (
          <ConfirmImportModal
            validation={validation}
            filename={preview.filename}
            onConfirm={doUpload}
            onCancel={() => setShowConfirm(false)}
            loading={uploadMutation.isPending}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap gap-y-2">
          <div className="flex items-center gap-3">
            <button
              onClick={cancelPreview}
              className="p-2 rounded-xl transition-colors"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <Table size={16} style={{ color: "var(--accent)" }} />
                <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Preview &amp; Edit</h1>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {preview.filename} · {dataRows.length} row{dataRows.length !== 1 ? "s" : ""}
                {isTruncated && ` (showing first ${MAX_PREVIEW_ROWS})`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Plus size={13} />} onClick={addRow}>
              Add Row
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<ShieldCheck size={13} />}
              onClick={requestImport}
              disabled={uploadMutation.isPending}
            >
              Review &amp; Import
            </Button>
          </div>
        </div>

        {/* Validation banner */}
        {validation && (
          <div className="space-y-2">
            {/* All-clear */}
            {!hasBlockers && validation.sanitizedCount === 0 && validation.dupSkus.length === 0 && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
                style={{ background: "rgba(var(--accent-success-rgb), 0.08)", border: "1px solid rgba(var(--accent-success-rgb), 0.22)" }}>
                <CheckCircle2 size={13} style={{ color: "var(--accent-success)" }} />
                <span style={{ color: "var(--text-secondary)" }}>
                  All <strong>{dataRows.length}</strong> rows validated — no issues found. Ready to import.
                </span>
              </div>
            )}
            {/* Sanitized */}
            {validation.sanitizedCount > 0 && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
                style={{ background: "rgba(var(--accent-warning-rgb), 0.08)", border: "1px solid rgba(var(--accent-warning-rgb), 0.22)" }}>
                <Info size={13} className="shrink-0" style={{ color: "var(--accent-warning)" }} />
                <span style={{ color: "var(--text-secondary)" }}>
                  <strong style={{ color: "var(--accent-warning)" }}>{validation.sanitizedCount} empty cell{validation.sanitizedCount !== 1 ? "s" : ""}</strong> auto-filled with <code style={{ color: "var(--accent)" }}>N/A</code>. Review and edit if needed.
                </span>
              </div>
            )}
            {/* Dup SKUs */}
            {validation.dupSkus.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
                style={{ background: "rgba(var(--accent-warning-rgb), 0.08)", border: "1px solid rgba(var(--accent-warning-rgb), 0.22)" }}>
                <AlertTriangle size={13} className="shrink-0" style={{ color: "var(--accent-warning)" }} />
                <span style={{ color: "var(--text-secondary)" }}>
                  Duplicate SKUs detected: <strong style={{ color: "var(--accent-warning)" }}>{validation.dupSkus.slice(0,4).join(", ")}{validation.dupSkus.length > 4 ? "…" : ""}</strong> — last row wins on import.
                </span>
              </div>
            )}
            {/* Empty SKU rows — blocker */}
            {hasBlockers && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
                style={{ background: "rgba(var(--accent-danger-rgb), 0.08)", border: "1px solid rgba(var(--accent-danger-rgb), 0.28)" }}>
                <XCircle size={13} className="shrink-0" style={{ color: "var(--accent-danger)" }} />
                <span style={{ color: "var(--text-secondary)" }}>
                  <strong style={{ color: "var(--accent-danger)" }}>{validation.emptySkuRows.length} row{validation.emptySkuRows.length !== 1 ? "s" : ""} missing SKU</strong> (highlighted in red). Add a SKU or delete the row before importing.
                </span>
              </div>
            )}
            {/* Missing optional columns */}
            {validation.missingOptional.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs"
                style={{ background: "rgba(var(--accent-rgb), 0.05)", border: "1px solid rgba(var(--accent-rgb), 0.15)" }}>
                <Info size={13} className="shrink-0" style={{ color: "var(--accent)" }} />
                <span style={{ color: "var(--text-secondary)" }}>
                  Optional columns not found: <span style={{ color: "var(--accent)" }}>{validation.missingOptional.join(", ")}</span> — defaults will be used.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Edit tip */}
        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
          style={{ background: "rgba(var(--accent-rgb), 0.06)", border: "1px solid rgba(var(--accent-rgb), 0.18)", color: "var(--text-secondary)" }}>
          <Edit3 size={13} className="shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
          Click any cell to edit. Red rows have no SKU and must be fixed or removed. Click Review &amp; Import when ready.
        </div>

        {/* Table */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "60vh" }}>
            <table className="w-full border-collapse text-xs" style={{ minWidth: "max-content" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "var(--bg-card)", borderBottom: "2px solid var(--border-card)" }}>
                  <th className="px-2 py-2 text-center w-8" style={{ color: "var(--text-muted)" }}>#</th>
                  {headers.map((h, ci) => {
                    const isRequired = REQUIRED_COLUMNS.map(c => c.toLowerCase()).includes(h.trim().toLowerCase());
                    return (
                      <th key={ci} className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                        style={{ minWidth: 120 }}>
                        <div className="flex items-center gap-1">
                          <input
                            value={h}
                            onChange={(e) => updateCell(0, ci, e.target.value)}
                            className="w-full bg-transparent outline-none font-semibold"
                            style={{ color: isRequired ? "var(--accent)" : "var(--text-secondary)" }}
                          />
                          {isRequired && (
                            <span className="text-[9px] font-bold shrink-0" style={{ color: "var(--accent-danger)" }} title="Required column">*</span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => {
                  const actualRowIdx = ri + 1; // index into editedRows
                  const isMissingSku = emptySkuSet.has(actualRowIdx);
                  return (
                    <tr
                      key={ri}
                      style={{
                        borderBottom: "1px solid var(--border-subtle)",
                        background: isMissingSku
                          ? "rgba(var(--accent-danger-rgb), 0.05)"
                          : ri % 2 === 0 ? "transparent" : "rgba(var(--accent-rgb), 0.02)",
                        outline: isMissingSku ? "1px solid rgba(var(--accent-danger-rgb), 0.35)" : "none",
                      }}
                    >
                      <td className="px-2 py-1.5 text-center text-xs" style={{ color: isMissingSku ? "var(--accent-danger)" : "var(--text-muted)" }}>
                        {isMissingSku ? "!" : ri + 1}
                      </td>
                      {row.map((cell, ci) => {
                        const isNa = cell === "N/A";
                        const isSkuCell = ci === skuColIdx;
                        return (
                          <td key={ci} className="px-1 py-1">
                            <input
                              value={cell}
                              onChange={(e) => updateCell(actualRowIdx, ci, e.target.value)}
                              className="w-full rounded-lg px-2 py-1 text-xs outline-none transition-colors"
                              style={{
                                background: "transparent",
                                color: isNa ? "var(--text-muted)" : isSkuCell ? "var(--accent)" : "var(--text-primary)",
                                border: "1px solid transparent",
                                minWidth: 100,
                                fontStyle: isNa ? "italic" : "normal",
                              }}
                              onFocus={(e) => {
                                (e.target as HTMLInputElement).style.borderColor = isSkuCell && isMissingSku ? "var(--accent-danger)" : "var(--accent)";
                                (e.target as HTMLInputElement).style.background = "var(--bg-card)";
                              }}
                              onBlur={(e) => {
                                (e.target as HTMLInputElement).style.borderColor = "transparent";
                                (e.target as HTMLInputElement).style.background = "transparent";
                              }}
                            />
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-center">
                        <button
                          onClick={() => deleteRow(ri + 1)}
                          className="p-1 rounded transition-colors"
                          style={{ color: isMissingSku ? "var(--accent-danger)" : "var(--text-muted)" }}
                          title="Delete row"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Upload mode ───────────────────────────────────────────────────────────
  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6 animate-fade-in">
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 max-w-6xl">
    <div className="space-y-6 min-w-0">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <FileSpreadsheet size={20} style={{ color: "var(--accent-success)" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Import Inventory</h1>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Upload CSV or Excel to bulk-import items &amp; transactions</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={downloadTemplate}>
          Template CSV
        </Button>
      </div>

      {/* Upload zone */}
      <Card>
        <CardContent className="pt-5">
          <div
            className={clsx(
              "border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer select-none",
              uploadMutation.isPending ? "pointer-events-none opacity-70" : "",
            )}
            style={
              dragging
                ? { borderColor: "var(--accent)", background: "rgba(var(--accent-rgb), 0.06)" }
                : { borderColor: "var(--border-card)", background: "var(--bg-card)" }
            }
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !uploadMutation.isPending && fileRef.current?.click()}
          >
            {uploadMutation.isPending ? (
              <>
                <RefreshCw size={36} className="mx-auto mb-3 animate-spin" style={{ color: "var(--accent)" }} />
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Uploading…</p>
              </>
            ) : (
              <>
                <Upload size={36} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Drop file here or click to browse
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  .xlsx, .xls, or .csv — up to 50 MB
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                    style={{ background: "rgba(var(--accent-rgb), 0.08)", color: "var(--accent)" }}>
                    <Eye size={11} /> CSV: preview &amp; edit before import
                  </span>
                  <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                    style={{ background: "rgba(var(--accent-success-rgb), 0.08)", color: "var(--accent-success)" }}>
                    <FileSpreadsheet size={11} /> Excel: imports directly
                  </span>
                </div>
              </>
            )}
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

      {/* Format guide */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>File Format</h3>
        </CardHeader>
        <CardContent className="space-y-4 text-sm" style={{ color: "var(--text-secondary)" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
              Required columns (CSV or Excel sheet "Items_Master")
            </p>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
              {[
                ["SKU", "Unique item code — required"],
                ["Description", "Item name"],
                ["Category", "Auto-created if missing"],
                ["Unit Cost", "Numeric, e.g. 12.50"],
                ["Reorder Level", "Minimum stock threshold"],
              ].map(([col, desc], i) => (
                <div key={col} className="flex items-center gap-3 px-4 py-2.5"
                  style={{
                    borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                    background: i % 2 === 0 ? "transparent" : "rgba(var(--accent-rgb), 0.02)",
                  }}>
                  <span className="font-mono text-xs shrink-0" style={{ color: "var(--accent)", minWidth: 140 }}>{col}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
              Optional sheet "Transactions" (Excel only)
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Columns: <span className="font-mono" style={{ color: "var(--accent)" }}>SKU, Type (IN/OUT), Qty, Notes</span> — imports stock history.
            </p>
          </div>
          <div className="rounded-xl px-4 py-3 flex gap-2"
            style={{ background: "rgba(var(--accent-success-rgb), 0.07)", border: "1px solid rgba(var(--accent-success-rgb), 0.18)" }}>
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" style={{ color: "var(--accent-success)" }} />
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Duplicate SKUs are <strong>updated</strong>, not duplicated. CSV files show an editable preview before import.
              Download the template above for the exact format.
            </p>
          </div>
        </CardContent>
      </Card>

    </div>{/* end left column */}

    {/* ── Right column ── */}
    <div className="space-y-4">
      {/* Import stats */}
      {jobs && jobs.length > 0 && (() => {
        const totalRows = jobs.reduce((s, j) => s + j.total_rows, 0);
        const imported = jobs.reduce((s, j) => s + j.imported_rows, 0);
        const errors = jobs.reduce((s, j) => s + j.error_rows, 0);
        const successRate = totalRows > 0 ? Math.round((imported / totalRows) * 100) : 0;
        return (
          <div className="rounded-2xl p-4 space-y-3"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Import Stats
            </p>
            {[
              { label: "Total Runs", value: jobs.length, color: "var(--accent)" },
              { label: "Rows Imported", value: imported.toLocaleString(), color: "var(--accent-success)" },
              { label: "Rows Updated", value: jobs.reduce((s, j) => s + j.skipped_rows, 0).toLocaleString(), color: "var(--accent-cyan)" },
              { label: "Errors", value: errors, color: errors > 0 ? "var(--accent-danger)" : "var(--text-muted)" },
              { label: "Success Rate", value: `${successRate}%`, color: successRate >= 90 ? "var(--accent-success)" : "var(--accent-warning)" },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</span>
                <span className="text-sm font-bold" style={{ color }}>{value}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Import history */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Import History
              {hasProcessing && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal" style={{ color: "var(--accent)" }}>
                  <RefreshCw size={11} className="animate-spin" /> Processing…
                </span>
              )}
            </h3>
            <button onClick={() => refetch()} className="p-1 rounded-lg transition-colors"
              style={{ color: "var(--text-muted)" }} title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="px-5 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>
          ) : !jobs || jobs.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <FileSpreadsheet size={28} className="mx-auto mb-2" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No imports yet</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Upload a file above to get started</p>
            </div>
          ) : (
            <div>
              {jobs.map((job, i) => (
                <ImportJobRow key={job.id} job={job} isLast={i === jobs.length - 1} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tips card */}
      <div className="rounded-2xl p-4 space-y-3"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Pro Tips</p>
        {[
          { tip: "SKU is the unique key — duplicates update existing items, never create doubles." },
          { tip: "CSV files get a live preview. Edit cells before confirming import." },
          { tip: "Add a Transactions sheet in Excel to bulk-import stock history." },
          { tip: "Categories and bin locations are auto-created if they don't exist." },
        ].map(({ tip }, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold"
              style={{ background: "rgba(var(--accent-rgb), 0.12)", color: "var(--accent)" }}>
              {i + 1}
            </div>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{tip}</p>
          </div>
        ))}
      </div>
    </div>{/* end right column */}
    </div>{/* end grid */}
    </div>
  );
}

function ImportJobRow({ job, isLast: _isLast }: { job: ImportJob; isLast: boolean }) {
  const [showErrors, setShowErrors] = useState(false);

  const statusConfig = {
    done: { icon: CheckCircle2, color: "var(--accent-success)", label: "Done", variant: "success" as const },
    processing: { icon: RefreshCw, color: "var(--accent)", label: "Processing", variant: "info" as const },
    pending: { icon: Clock, color: "var(--text-muted)", label: "Pending", variant: "info" as const },
    failed: { icon: XCircle, color: "var(--accent-danger)", label: "Failed", variant: "danger" as const },
  }[job.status] ?? { icon: AlertTriangle, color: "var(--accent-warning)", label: job.status, variant: "warning" as const };

  const StatusIcon = statusConfig.icon;
  const isSpinning = job.status === "processing";

  let parsedErrors: string[] = [];
  if (job.errors) {
    try { parsedErrors = JSON.parse(job.errors); } catch { parsedErrors = [job.errors]; }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center gap-3 px-5 py-4">
        <StatusIcon
          size={18}
          className={clsx("shrink-0", isSpinning && "animate-spin")}
          style={{ color: statusConfig.color }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{job.filename}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            <span style={{ color: "var(--accent-success)" }}>{job.imported_rows} imported</span>
            {job.skipped_rows > 0 && <span className="ml-2">{job.skipped_rows} updated</span>}
            {job.error_rows > 0 && (
              <span className="ml-2" style={{ color: "var(--accent-danger)" }}>{job.error_rows} errors</span>
            )}
            {job.total_rows > 0 && <span className="ml-2">/ {job.total_rows} total</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          {parsedErrors.length > 0 && (
            <button
              onClick={() => setShowErrors((v) => !v)}
              className="p-1 rounded-lg transition-colors text-xs flex items-center gap-1"
              style={{ color: "var(--accent-warning)" }}
            >
              <AlertTriangle size={12} />
              {showErrors ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>
      </div>

      {showErrors && parsedErrors.length > 0 && (
        <div className="px-5 pb-4">
          <div className="rounded-xl overflow-hidden max-h-48 overflow-y-auto"
            style={{ background: "rgba(var(--accent-danger-rgb), 0.05)", border: "1px solid rgba(var(--accent-danger-rgb), 0.18)" }}>
            {parsedErrors.map((err, i) => (
              <div key={i} className="px-3 py-2 text-xs font-mono"
                style={{ color: "var(--accent-danger)", borderTop: i > 0 ? "1px solid rgba(var(--accent-danger-rgb), 0.10)" : "none" }}>
                {err}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
