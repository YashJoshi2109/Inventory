import { apiClient } from "./client";
import { useAuthStore } from "@/store/auth";

const BASE = (import.meta.env.VITE_API_URL ?? "/api/v1").replace(/\/+$/, "");

export interface VisionAnalysisResult {
  detected_items: Array<{
    name: string;
    category: string;
    brand: string;
    model: string;
    quantity: number;
    confidence: number;
    notes: string;
  }>;
  ocr_text: string;
  item_count: number;
  damage_detected: boolean;
  damage_notes: string;
  metadata_suggestions: {
    category: string;
    tags: string[];
    brand: string;
    model: string;
    usage_type: string;
  };
  shelf_audit: {
    total_visible: number;
    organized: boolean;
    issues: string[];
  };
  raw_analysis: string;
  analysis_type: string;
}

export interface MetadataSuggestion {
  category: string;
  tags: string[];
  brand: string;
  model: string;
  usage_type: string;
  description: string;
  unit: string;
}

export const aiApi = {
  analyzeVision: async (
    image: File | Blob,
    analysisType = "full",
    context = ""
  ): Promise<VisionAnalysisResult> => {
    const token = useAuthStore.getState().accessToken;
    const form = new FormData();
    form.append("image", image, "capture.jpg");
    form.append("analysis_type", analysisType);
    form.append("context", context);

    const res = await fetch(`${BASE}/ai/vision/analyze`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Vision analysis failed");
    }
    return res.json();
  },

  suggestMetadata: async (name: string, description = ""): Promise<MetadataSuggestion> => {
    const form = new FormData();
    form.append("name", name);
    form.append("description", description);
    const res = await apiClient.post<MetadataSuggestion>("/ai/metadata/suggest", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  },
};
