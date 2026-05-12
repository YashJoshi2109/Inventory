import { apiClient } from "./client";
import type { Item, ItemSummary, PaginatedResponse, StockLevel, Category } from "@/types";

export interface ItemsListParams {
  q?: string;
  category_id?: number;
  status?: string;
  page?: number;
  page_size?: number;
}

export interface ItemCreatePayload {
  sku: string;
  name: string;
  description?: string;
  category_id?: number;
  unit?: string;
  unit_cost?: number;
  sale_price?: number;
  reorder_level?: number;
  reorder_qty?: number;
  lead_days?: number;
  supplier?: string;
}

export const itemsApi = {
  list: async (params: ItemsListParams = {}): Promise<PaginatedResponse<ItemSummary>> => {
    const { data } = await apiClient.get<PaginatedResponse<ItemSummary>>("/items", { params });
    return data;
  },

  get: async (id: number): Promise<Item> => {
    const { data } = await apiClient.get<Item>(`/items/${id}`);
    return data;
  },

  create: async (payload: ItemCreatePayload): Promise<Item> => {
    const { data } = await apiClient.post<Item>("/items", payload);
    return data;
  },

  update: async (id: number, payload: Partial<Item>): Promise<Item> => {
    const { data } = await apiClient.patch<Item>(`/items/${id}`, payload);
    return data;
  },

  deactivate: async (id: number): Promise<void> => {
    await apiClient.delete(`/items/${id}`);
  },

  getStockLevels: async (id: number): Promise<StockLevel[]> => {
    const { data } = await apiClient.get<StockLevel[]>(`/items/${id}/stock-levels`);
    return data;
  },

  getCategories: async (): Promise<Category[]> => {
    const { data } = await apiClient.get<Category[]>("/items/categories");
    return data;
  },

  createCategory: async (payload: { name: string; item_type?: string; color?: string; icon?: string; description?: string }): Promise<Category> => {
    const { data } = await apiClient.post<Category>("/items/categories", payload);
    return data;
  },

  printLabelSheet: async (itemIds: number[]): Promise<Blob> => {
    const { data } = await apiClient.post("/barcodes/labels/print", itemIds, {
      responseType: "blob",
    });
    return data;
  },

  /**
   * Bulk-print Avery 5160 QR labels for every active item matching the filters.
   * Mirrors the /items filter semantics — pass the same q/status/category the
   * Inventory page is currently showing so WYSIWYG.
   */
  printBulkLabels: async (params: {
    q?: string;
    category_id?: number;
    status?: string;
  }): Promise<{ blob: Blob; count: number; matched: number }> => {
    const response = await apiClient.get("/barcodes/labels/print-bulk", {
      params,
      responseType: "blob",
    });
    return {
      blob: response.data,
      count: Number(response.headers["x-labels-count"] ?? 0),
      matched: Number(response.headers["x-items-matched"] ?? 0),
    };
  },

  downloadBarcodePng: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/barcodes/item/${id}/png`, { responseType: "blob" });
    return data;
  },

  downloadQrPng: async (id: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/barcodes/item/${id}/qr/png`, { responseType: "blob" });
    return data;
  },

  downloadLocationQrPng: async (locationId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/barcodes/location/${locationId}/qr/png`, { responseType: "blob" });
    return data;
  },

  downloadLocationGs1QrPng: async (locationId: number): Promise<Blob> => {
    const { data } = await apiClient.get(`/barcodes/location/${locationId}/gs1-qr/png`, { responseType: "blob" });
    return data;
  },

  getBarcodeMeta: async (id: number): Promise<{ gtin14: string; gtin12: string; serial: string; epc_hex: string; gs1_url: string }> => {
    const { data } = await apiClient.get(`/barcodes/item/${id}/meta`);
    return data;
  },

  getLocationBarcodeMeta: async (id: number): Promise<{ gln13: string; epc_hex: string; code128_value: string; gs1_url: string }> => {
    const { data } = await apiClient.get(`/barcodes/location/${id}/meta`);
    return data;
  },

  sendQrToEmail: async (itemId: number): Promise<{ message: string; success: boolean }> => {
    const { data } = await apiClient.post(`/barcodes/item/${itemId}/qr/send-email`);
    return data;
  },
};
