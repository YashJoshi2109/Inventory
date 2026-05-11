import { apiClient } from "./client";

export interface ResolvedRfidItem {
  item_id: number;
  sku: string;
  name: string;
  unit: string;
  category: string;
  total_quantity: number;
  reorder_level: number;
  unit_cost: number;
  epc: string;
}

export interface EpcScanResponse {
  found: boolean;
  epc: string;
  item: ResolvedRfidItem | null;
}

export interface BatchScanResponse {
  matched: ResolvedRfidItem[];
  unknown_epcs: string[];
}

export interface BatchActionResult {
  item_id: number;
  sku: string;
  success: boolean;
  error: string | null;
}

export interface EpcInfoResponse {
  item_id: number;
  sku: string;
  name: string;
  epc: string;
}

export const rfidApi = {
  scanEpc: (epc: string): Promise<EpcScanResponse> =>
    apiClient.post("/rfid/scan", { epc }).then((r) => r.data),

  batchStockIn: (payload: {
    item_ids: number[];
    location_id: number;
    quantity_each: number;
    reference?: string;
    notes?: string;
  }): Promise<BatchActionResult[]> =>
    apiClient.post("/rfid/batch-stock-in", payload).then((r) => r.data),

  batchStockOut: (payload: {
    item_ids: number[];
    location_id: number;
    quantity_each: number;
    reason?: string;
    notes?: string;
  }): Promise<BatchActionResult[]> =>
    apiClient.post("/rfid/batch-stock-out", payload).then((r) => r.data),

  getItemEpc: (item_id: number): Promise<EpcInfoResponse> =>
    apiClient.get(`/rfid/epc/${item_id}`).then((r) => r.data),

  registerEpc: (item_id: number, epc: string): Promise<EpcInfoResponse> =>
    apiClient.post("/rfid/register-epc", { item_id, epc }).then((r) => r.data),
};
