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

  printLabelSheet: async (itemIds: number[]): Promise<Blob> => {
    const { data } = await apiClient.post("/barcodes/labels/print", itemIds, {
      responseType: "blob",
    });
    return data;
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
};
