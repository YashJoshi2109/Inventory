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
  scan: (epc: string) =>
    apiClient.post<EpcScanResponse>("/rfid/scan", { epc }).then((r) => r.data),

  batchScan: (epcs: string[]) =>
    apiClient.post<BatchScanResponse>("/rfid/batch-scan", { epcs }).then((r) => r.data),

  batchStockIn: (
    item_ids: number[],
    location_id: number,
    quantity_each = 1.0,
    reference?: string,
  ) =>
    apiClient
      .post<BatchActionResult[]>("/rfid/batch-stock-in", {
        item_ids,
        location_id,
        quantity_each,
        reference,
      })
      .then((r) => r.data),

  batchStockOut: (
    item_ids: number[],
    location_id: number,
    quantity_each = 1.0,
    reason?: string,
  ) =>
    apiClient
      .post<BatchActionResult[]>("/rfid/batch-stock-out", {
        item_ids,
        location_id,
        quantity_each,
        reason,
      })
      .then((r) => r.data),

  getItemEpc: (item_id: number) =>
    apiClient.get<EpcInfoResponse>(`/rfid/epc/${item_id}`).then((r) => r.data),

  registerEpc: (item_id: number, epc: string) =>
    apiClient
      .post<EpcInfoResponse>("/rfid/register-epc", { item_id, epc })
      .then((r) => r.data),
};
