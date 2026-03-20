// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface Role {
  id: number;
  name: string;
  description: string | null;
}

export interface User {
  id: number;
  email: string;
  username: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  avatar_url: string | null;
  last_login_at: string | null;
  created_at: string;
  roles: Role[];
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

// ─── Items ────────────────────────────────────────────────────────────────────
export interface Category {
  id: number;
  name: string;
  item_type: string;
  color: string | null;
  icon: string | null;
}

export interface ItemBarcode {
  id: number;
  barcode_type: string;
  barcode_value: string;
  is_primary: boolean;
  label_printed: boolean;
}

export interface Item {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  category: Category | null;
  unit: string;
  unit_cost: number;
  sale_price: number;
  reorder_level: number;
  reorder_qty: number;
  lead_days: number;
  supplier: string | null;
  part_number: string | null;
  cas_number: string | null;
  hazard_class: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  barcodes: ItemBarcode[];
  total_quantity: number;
  status: "OK" | "LOW" | "OUT";
  /** Present only on POST /items (create) — embedded QR PNG */
  qr_png_base64?: string | null;
}

export interface ItemSummary {
  id: number;
  sku: string;
  name: string;
  unit: string;
  category_name: string | null;
  total_quantity: number;
  reorder_level: number;
  status: "OK" | "LOW" | "OUT";
  unit_cost: number;
}

export interface StockLevel {
  id: number;
  item_id: number;
  location_id: number;
  location_code: string;
  location_name: string;
  quantity: number;
  last_event_at: string;
}

// ─── Locations ────────────────────────────────────────────────────────────────
export interface Area {
  id: number;
  code: string;
  name: string;
  description: string | null;
  building: string | null;
  floor: string | null;
  room: string | null;
  is_active: boolean;
  created_at: string;
  location_count: number;
}

export interface LocationBarcode {
  id: number;
  barcode_value: string;
  barcode_type: string;
  label_printed: boolean;
}

export interface Location {
  id: number;
  area_id: number;
  area_code: string;
  area_name: string;
  code: string;
  name: string;
  description: string | null;
  shelf: string | null;
  bin_label: string | null;
  capacity: number | null;
  is_active: boolean;
  created_at: string;
  barcodes: LocationBarcode[];
  item_count: number;
}

// ─── Transactions ─────────────────────────────────────────────────────────────
export type EventKind = "STOCK_IN" | "STOCK_OUT" | "TRANSFER" | "ADJUSTMENT" | "CYCLE_COUNT" | "IMPORT";

export interface InventoryEvent {
  id: number;
  occurred_at: string;
  event_kind: EventKind;
  item_id: number;
  item_sku: string;
  item_name: string;
  from_location_id: number | null;
  from_location_code: string | null;
  to_location_id: number | null;
  to_location_code: string | null;
  quantity: number;
  reference: string | null;
  borrower: string | null;
  notes: string | null;
  reason: string | null;
  actor_username: string | null;
  source: string;
}

export interface Alert {
  id: number;
  item_id: number | null;
  item_sku: string | null;
  item_name: string | null;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  is_resolved: boolean;
  created_at: string;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export interface DashboardStats {
  total_items: number;
  total_skus: number;
  items_low_stock: number;
  items_out_of_stock: number;
  total_inventory_value: number;
  transactions_today: number;
  transactions_this_week: number;
  active_alerts: number;
  category_breakdown: Array<{ id: number; name: string; color: string | null; icon: string | null; count: number }>;
  recent_activity: InventoryEvent[];
  top_consumed: Array<{ id: number; sku: string; name: string; total_consumed: number }>;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────
export type ScanResultType = "item" | "location" | "unknown";

export interface ScanResult {
  result_type: ScanResultType;
  id: number | null;
  code: string;
  name: string;
  details: {
    total_quantity?: number;
    unit?: string;
    category?: string;
    [key: string]: unknown;
  };
}

// ─── Pagination ───────────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ─── AI ───────────────────────────────────────────────────────────────────────
export interface ForecastResult {
  item_id: number;
  item_sku: string;
  item_name: string;
  method: string;
  avg_daily_consumption: number;
  forecast_7d: number;
  forecast_30d: number;
  days_of_stock_remaining: number;
  reorder_date: string | null;
  confidence: number;
  message: string;
}

// ─── Offline sync ─────────────────────────────────────────────────────────────
export type OfflineQueueStatus = "pending" | "syncing" | "done" | "failed";

export interface OfflineQueueItem {
  id: string;
  method: "POST" | "PATCH" | "DELETE";
  url: string;
  body: unknown;
  created_at: string;
  status: OfflineQueueStatus;
  retry_count: number;
  error?: string;
}
