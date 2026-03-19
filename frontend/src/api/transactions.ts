import { apiClient } from "./client";
import type {
  InventoryEvent,
  PaginatedResponse,
  Alert,
  DashboardStats,
  ScanResult,
  ForecastResult,
} from "@/types";

export const transactionsApi = {
  list: async (params?: {
    item_id?: number;
    location_id?: number;
    event_kind?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResponse<InventoryEvent>> => {
    const { data } = await apiClient.get<PaginatedResponse<InventoryEvent>>("/transactions", { params });
    return data;
  },

  getAlerts: async (): Promise<Alert[]> => {
    const { data } = await apiClient.get<Alert[]>("/transactions/alerts");
    return data;
  },

  resolveAlert: async (id: number): Promise<Alert> => {
    const { data } = await apiClient.patch<Alert>(`/transactions/alerts/${id}/resolve`);
    return data;
  },
};

export const scanApi = {
  lookup: async (barcode_value: string): Promise<ScanResult> => {
    const { data } = await apiClient.post<ScanResult>("/scans/lookup", { barcode_value });
    return data;
  },

  stockIn: async (payload: {
    item_id: number;
    location_id: number;
    quantity: number;
    reference?: string;
    notes?: string;
    scan_session_id?: string;
  }): Promise<InventoryEvent> => {
    const { data } = await apiClient.post<InventoryEvent>("/scans/stock-in", payload);
    return data;
  },

  stockOut: async (payload: {
    item_id: number;
    location_id: number;
    quantity: number;
    reason?: string;
    reference?: string;
    borrower?: string;
    notes?: string;
    override_negative?: boolean;
    scan_session_id?: string;
  }): Promise<InventoryEvent> => {
    const { data } = await apiClient.post<InventoryEvent>("/scans/stock-out", payload);
    return data;
  },

  transfer: async (payload: {
    item_id: number;
    from_location_id: number;
    to_location_id: number;
    quantity: number;
    reference?: string;
    notes?: string;
    scan_session_id?: string;
  }): Promise<InventoryEvent> => {
    const { data } = await apiClient.post<InventoryEvent>("/scans/transfer", payload);
    return data;
  },

  adjustment: async (payload: {
    item_id: number;
    location_id: number;
    new_quantity: number;
    reason: string;
    notes?: string;
  }): Promise<InventoryEvent> => {
    const { data } = await apiClient.post<InventoryEvent>("/scans/adjustment", payload);
    return data;
  },

  apply: async (payload: {
    item_barcode: string;
    rack_barcode: string;
    event_type: "stock_in" | "stock_out" | "transfer";
    destination_rack_barcode?: string;
    quantity: number;
    reason?: string;
    reference?: string;
    borrower?: string;
    notes?: string;
    override_negative?: boolean;
    scan_session_id?: string;
  }): Promise<InventoryEvent> => {
    const { data } = await apiClient.post<InventoryEvent>("/scans/apply", payload);
    return data;
  },

  modifyItem: async (payload: {
    item_id: number;
    name?: string;
    description?: string;
    category_id?: number;
    unit?: string;
    unit_cost?: number;
    reorder_level?: number;
    supplier?: string;
    notes?: string;
  }): Promise<{ id: number; sku: string; name: string }> => {
    const { data } = await apiClient.post("/scans/modify-item", payload);
    return data;
  },
};

export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const { data } = await apiClient.get<DashboardStats>("/dashboard/stats");
    return data;
  },
};

export const aiApi = {
  search: async (q: string): Promise<{ query: string; hits: unknown[]; total: number }> => {
    const { data } = await apiClient.get("/ai/search", { params: { q } });
    return data;
  },

  forecast: async (item_id: number): Promise<ForecastResult> => {
    const { data } = await apiClient.get<ForecastResult>(`/ai/forecast/${item_id}`);
    return data;
  },

  rebuildIndex: async (): Promise<void> => {
    await apiClient.post("/ai/index/rebuild");
  },
};
