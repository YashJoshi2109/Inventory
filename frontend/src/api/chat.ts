import { apiClient } from "./client";
import { useAuthStore } from "@/store/auth";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

export interface ChatSession {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_name: string | null;
  tool_result: string | null;
  sources: string | null;
  created_at: string;
}

export interface KnowledgeDocument {
  id: number;
  title: string;
  filename: string;
  doc_type: string;
  status: string;
  chunk_count: number;
  created_at: string;
}

// SSE event shapes
export type SseEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; data: Record<string, unknown> }
  | { type: "done"; message_id?: number }
  | { type: "error"; message: string };

export const chatApi = {
  createSession: async (title = "New chat"): Promise<ChatSession> => {
    const { data } = await apiClient.post<ChatSession>("/chat/sessions", { title });
    return data;
  },

  listSessions: async (): Promise<ChatSession[]> => {
    const { data } = await apiClient.get<ChatSession[]>("/chat/sessions");
    return data;
  },

  deleteSession: async (id: number): Promise<void> => {
    await apiClient.delete(`/chat/sessions/${id}`);
  },

  renameSession: async (id: number, title: string): Promise<ChatSession> => {
    const { data } = await apiClient.patch<ChatSession>(`/chat/sessions/${id}/title`, { title });
    return data;
  },

  getMessages: async (sessionId: number): Promise<ChatMessage[]> => {
    const { data } = await apiClient.get<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`);
    return data;
  },

  listDocuments: async (): Promise<KnowledgeDocument[]> => {
    const { data } = await apiClient.get<KnowledgeDocument[]>("/chat/documents");
    return data;
  },

  uploadDocument: async (file: File, docType = "general", title = ""): Promise<KnowledgeDocument> => {
    const form = new FormData();
    form.append("file", file);
    form.append("doc_type", docType);
    form.append("title", title || file.name);
    const { data } = await apiClient.post<KnowledgeDocument>("/chat/documents", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },

  deleteDocument: async (id: number): Promise<void> => {
    await apiClient.delete(`/chat/documents/${id}`);
  },

  /**
   * Stream a chat message using SSE (fetch with readable stream).
   * Calls onEvent for each SSE payload, calls onDone when finished.
   * Optional `image` attaches a photo for vision queries.
   */
  streamMessage: async (
    sessionId: number,
    content: string,
    onEvent: (event: SseEvent) => void,
    signal?: AbortSignal,
    image?: File | null,
  ): Promise<void> => {
    const token = useAuthStore.getState().accessToken;
    const url = `${BASE_URL}/chat/sessions/${sessionId}/messages`;

    const form = new FormData();
    form.append("content", content);
    if (image) form.append("image", image);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Do NOT set Content-Type — browser sets it with the correct boundary for FormData
      },
      body: form,
      signal,
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let message = `HTTP ${response.status}: ${raw || "Unknown error"}`;
      if (response.status === 429) {
        message = "Rate limit reached — please wait a moment before sending another message.";
      } else if (response.status === 401 || response.status === 403) {
        message = "Authentication error. Please refresh the page and sign in again.";
      } else if (response.status >= 500) {
        message = "The AI service is temporarily unavailable. Please try again in a few seconds.";
      }
      onEvent({ type: "error", message });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onEvent({ type: "error", message: "No response body" });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const evt = JSON.parse(raw) as SseEvent;
          onEvent(evt);
          if (evt.type === "done" || evt.type === "error") return;
        } catch {
          // malformed SSE line — ignore
        }
      }
    }
  },
};
