import { apiClient } from "./client";
import type { Item, ItemSummary, PaginatedResponse, StockLevel, Category } from "@/types";

export interface ItemsListParams {
  q?: string;
  category_id?: number;
  status?: string;
  page?: number;
  page_size?: number;
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

  create: async (payload: Partial<Item>): Promise<Item> => {
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

  getBarcodePng: (id: number): string => `/api/v1/barcodes/item/${id}/png`,
  getQrPng: (id: number): string => `/api/v1/barcodes/item/${id}/qr/png`,
};
