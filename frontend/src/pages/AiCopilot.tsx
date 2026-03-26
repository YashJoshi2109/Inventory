/**
 * AI Copilot — production-grade chat UI.
 *
 * Bug fixes vs. v1:
 * 1. Messages no longer disappear: useEffect(history) is guarded by a
 *    `streamingRef` so it never overwrites an active stream.
 * 2. Duplicate sessions fixed: activeSessionId is tracked in a ref (not only
 *    state) so the sendMessage closure always sees the latest value.
 * 3. No query invalidation during streaming — messages are only refreshed
 *    from server after the stream fully completes.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  chatApi,
  type ChatSession,
  type SseEvent,
} from "@/api/chat";
import {
  Bot,
  Send,
  Plus,
  Trash2,
  Edit3,
  Search,
  X,
  Paperclip,
  Package,
  TrendingDown,
  MapPin,
  Clock,
  BarChart3,
  ChevronRight,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Beaker,
  Zap,
  Menu,
  RefreshCw,
} from "lucide-react";
import { clsx } from "clsx";
import ReactMarkdown from "react-markdown";
import { useAuthStore } from "@/store/auth";
import { rateLimitApi } from "@/api/rateLimit";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  done: boolean;
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCall[];
  streaming: boolean;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOOL_META: Record<string, { label: string; color: string; bg: string }> = {
  search_inventory:        { label: "Searching inventory",    color: "#22d3ee", bg: "rgba(34,211,238,0.08)" },
  get_item_details:        { label: "Fetching item details",  color: "#a78bfa", bg: "rgba(167,139,250,0.08)" },
  get_location_contents:   { label: "Checking location",      color: "#34d399", bg: "rgba(52,211,153,0.08)" },
  list_low_stock_items:    { label: "Checking stock levels",  color: "#fbbf24", bg: "rgba(251,191,36,0.08)" },
  list_overdue_items:      { label: "Finding idle items",     color: "#fb923c", bg: "rgba(251,146,60,0.08)" },
  get_dashboard_summary:   { label: "Loading dashboard",      color: "#60a5fa", bg: "rgba(96,165,250,0.08)" },
  perform_stock_in:        { label: "Adding stock",           color: "#34d399", bg: "rgba(52,211,153,0.08)" },
  perform_stock_out:       { label: "Removing stock",         color: "#f87171", bg: "rgba(248,113,113,0.08)" },
  perform_transfer:        { label: "Transferring item",      color: "#c084fc", bg: "rgba(192,132,252,0.08)" },
  list_locations:          { label: "Loading locations",      color: "#94a3b8", bg: "rgba(148,163,184,0.08)" },
  get_transaction_history: { label: "Loading transactions",   color: "#60a5fa", bg: "rgba(96,165,250,0.08)" },
};

const SUGGESTIONS = [
  { icon: BarChart3,    text: "Show inventory overview",       color: "#60a5fa" },
  { icon: TrendingDown, text: "What items are running low?",   color: "#fbbf24" },
  { icon: Clock,        text: "Find items unused for 90 days", color: "#fb923c" },
  { icon: Package,      text: "Search for Arduino kits",       color: "#22d3ee" },
  { icon: MapPin,       text: "What's in Embedded Lab?",       color: "#34d399" },
  { icon: Zap,          text: "Show recent transactions",      color: "#a78bfa" },
];

const DOC_TYPES = ["general", "sop", "manual", "calibration", "invoice", "policy", "maintenance"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId() { return Math.random().toString(36).slice(2); }

// ── Sub-components ────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 ml-1">
      {[0,1,2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-bounce"
          style={{ animationDelay: `${i * 0.12}s`, animationDuration: "0.7s" }} />
      ))}
    </span>
  );
}

function ToolBadge({ tc }: { tc: ToolCall }) {
  const m = TOOL_META[tc.name] ?? { label: tc.name, color: "#94a3b8", bg: "rgba(148,163,184,0.08)" };
  const hasError = tc.result && "error" in tc.result;
  const total = tc.result && "total" in tc.result ? (tc.result.total as number) : undefined;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs mb-1.5 transition-all"
      style={{ background: m.bg, border: `1px solid ${m.color}20` }}>
      {!tc.done
        ? <Loader2 size={11} className="animate-spin shrink-0" style={{ color: m.color }} />
        : hasError
        ? <AlertCircle size={11} className="shrink-0 text-red-400" />
        : <CheckCircle2 size={11} className="shrink-0" style={{ color: m.color }} />}
      <span style={{ color: m.color }} className="font-medium">{m.label}</span>
      {tc.done && !hasError && (
        <span className="text-slate-500 ml-auto">
          {total !== undefined ? `${total} result${total !== 1 ? "s" : ""}` : "done"}
        </span>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-5">
        <div className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm text-white leading-relaxed"
          style={{
            background: "linear-gradient(135deg,#0891b2,#22d3ee)",
            boxShadow: "0 4px 18px rgba(34,211,238,0.22)",
          }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-5">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{
          background: "linear-gradient(135deg,rgba(8,145,178,0.25),rgba(34,211,238,0.12))",
          border: "1px solid rgba(34,211,238,0.18)",
        }}>
        <Bot size={13} className="text-brand-400" />
      </div>

      <div className="flex-1 min-w-0">
        {msg.toolCalls.map((tc, i) => <ToolBadge key={i} tc={tc} />)}

        {(msg.content || msg.streaming) && (
          <div className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-slate-200 leading-relaxed"
            style={{
              background: "rgba(255,255,255,0.035)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}>
            {msg.streaming && !msg.content
              ? <TypingDots />
              : <div className="prose prose-invert prose-sm max-w-none
                  [&>p]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0
                  [&>ul]:my-1 [&>ol]:my-1 [&>li]:my-0.5
                  [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-sm
                  [&>strong]:text-white [&>code]:text-brand-300">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                  {msg.streaming && <TypingDots />}
                </div>}
          </div>
        )}

        {msg.error && (
          <div className="px-4 py-3 rounded-2xl text-sm"
            style={{ background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
            {msg.error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Knowledge base panel ───────────────────────────────────────────────────────

function KBPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["chat-docs"],
    queryFn: chatApi.listDocuments,
  });
  const [docType, setDocType] = useState("general");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await chatApi.uploadDocument(file, docType, file.name);
      qc.invalidateQueries({ queryKey: ["chat-docs"] });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col h-full"
      style={{ background: "rgba(5,11,25,0.98)", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between px-4 py-3.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-brand-400" />
          <span className="text-sm font-semibold text-slate-100">Knowledge Base</span>
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-white/5">
          <X size={15} />
        </button>
      </div>

      <div className="p-4 space-y-2.5">
        <select value={docType} onChange={e => setDocType(e.target.value)}
          className="w-full text-xs rounded-xl px-3 py-2 text-slate-300 outline-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
          {DOC_TYPES.map(t => (
            <option key={t} value={t} className="bg-slate-900">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>

        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-60"
          style={{
            background: "rgba(34,211,238,0.08)",
            border: "1px solid rgba(34,211,238,0.2)",
            color: "#22d3ee",
          }}>
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {uploading ? "Uploading…" : "Upload Document"}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.csv" className="hidden" onChange={upload} />
        <p className="text-[10px] text-slate-600 text-center">PDF · DOCX · TXT · MD · CSV</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {isLoading && <div className="flex justify-center py-6"><Loader2 size={15} className="animate-spin text-slate-600" /></div>}
        {docs.map(doc => (
          <div key={doc.id} className="flex items-start gap-2.5 p-3 rounded-xl group transition-all"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <FileText size={13} className="text-brand-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{doc.title}</p>
              <p className="text-[10px] mt-0.5" style={{ color: doc.status === "ready" ? "#34d399" : doc.status === "failed" ? "#f87171" : "#fbbf24" }}>
                {doc.doc_type} · {doc.chunk_count} chunks · {doc.status}
              </p>
            </div>
            <button onClick={() => chatApi.deleteDocument(doc.id).then(() => qc.invalidateQueries({ queryKey: ["chat-docs"] }))}
              className="opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400 transition-all shrink-0">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
        {docs.length === 0 && !isLoading && (
          <div className="py-8 text-center">
            <FileText size={24} className="text-slate-800 mx-auto mb-2" />
            <p className="text-xs text-slate-600">Upload SOPs, manuals, or calibration records for grounded AI answers.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AiCopilot() {
  const qc = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);

  // State
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [showKB, setShowKB] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // Refs — avoid stale closures
  const activeSessionIdRef = useRef<number | null>(null);
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const quotaAnchorRef = useRef<HTMLDivElement>(null);
  const [quotaCardOpen, setQuotaCardOpen] = useState(false);
  const [quotaCardPos, setQuotaCardPos] = useState<{ top: number; left: number } | null>(null);

  // Derived state that mirrors the ref (for rendering)
  const [activeSessionId, _setActiveSessionId] = useState<number | null>(null);
  const [streaming, _setStreaming] = useState(false);

  // Sync wrappers
  const setActiveSessionId = (id: number | null) => {
    activeSessionIdRef.current = id;
    _setActiveSessionId(id);
  };
  const setStreaming = (v: boolean) => {
    streamingRef.current = v;
    _setStreaming(v);
  };

  const openQuotaCard = () => {
    const el = quotaAnchorRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const width = 300; // card width
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    const top = rect.bottom + 10;
    setQuotaCardPos({ top, left });
    setQuotaCardOpen(true);
    // Fetch fresh quota immediately when user interacts.
    void refetchChatRateLimit();
  };

  const closeQuotaCard = () => setQuotaCardOpen(false);

  useEffect(() => {
    if (!quotaCardOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = quotaAnchorRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        closeQuotaCard();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [quotaCardOpen]);

  // Queries
  const { data: sessions = [] } = useQuery({
    queryKey: ["chat-sessions"],
    queryFn: chatApi.listSessions,
    refetchInterval: 60_000,
  });

  const { data: chatRateLimit, refetch: refetchChatRateLimit } = useQuery({
    queryKey: ["chat-rate-limit"],
    queryFn: rateLimitApi.getChatRateLimit,
    enabled: !!accessToken,
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: false,
  });

  const { data: serverMessages = [] } = useQuery({
    queryKey: ["chat-messages", activeSessionId],
    queryFn: () => activeSessionId ? chatApi.getMessages(activeSessionId) : Promise.resolve([]),
    enabled: !!activeSessionId,
    staleTime: 5_000,
  });

  // ── Sync server messages → local state (ONLY when not streaming) ──────────
  useEffect(() => {
    if (streamingRef.current) return;                     // never clobber live stream
    if (serverMessages.length === 0) {
      setMessages([]);
      return;
    }
    const mapped: Msg[] = serverMessages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({
        id: String(m.id),
        role: m.role as "user" | "assistant",
        content: m.content ?? "",
        toolCalls: [],
        streaming: false,
      }));
    setMessages(mapped);
  }, [serverMessages]);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Mutations
  const createSession = useMutation({
    mutationFn: (title: string) => chatApi.createSession(title),
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ["chat-sessions"] });
      setActiveSessionId(session.id);
      setMessages([]);
    },
  });

  const deleteSession = useMutation({
    mutationFn: chatApi.deleteSession,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["chat-sessions"] });
      if (activeSessionIdRef.current === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
    },
  });

  // ── Session actions ────────────────────────────────────────────────────────
  const newChat = useCallback(() => createSession.mutate("New chat"), [createSession]);

  const selectSession = (id: number) => {
    if (streamingRef.current) { abortRef.current?.abort(); setStreaming(false); }
    setActiveSessionId(id);
    setMessages([]);
    qc.invalidateQueries({ queryKey: ["chat-messages", id] });
  };

  const renameSession = async (id: number, title: string) => {
    if (!title.trim()) return;
    await chatApi.renameSession(id, title);
    qc.invalidateQueries({ queryKey: ["chat-sessions"] });
    setEditingId(null);
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || streamingRef.current) return;

    // Resolve session (use ref to avoid stale closure)
    let sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      try {
        const session = await chatApi.createSession(content.slice(0, 60));
        qc.invalidateQueries({ queryKey: ["chat-sessions"] });
        setActiveSessionId(session.id);
        sessionId = session.id;
      } catch {
        return;
      }
    }

    setInput("");
    const uId = makeId();
    const aId = makeId();

    // Optimistically add user + placeholder assistant message
    setMessages(prev => [
      ...prev,
      { id: uId, role: "user", content, toolCalls: [], streaming: false },
      { id: aId, role: "assistant", content: "", toolCalls: [], streaming: true },
    ]);

    setStreaming(true);
    abortRef.current = new AbortController();
    let accContent = "";

    const finalSessionId = sessionId; // capture for closure

    try {
      await chatApi.streamMessage(
        finalSessionId,
        content,
        (event: SseEvent) => {
          switch (event.type) {
            case "token":
              accContent += event.content;
              setMessages(prev => prev.map(m =>
                m.id === aId ? { ...m, content: accContent } : m
              ));
              break;

            case "tool_call":
              setMessages(prev => prev.map(m => {
                if (m.id !== aId) return m;
                return { ...m, toolCalls: [...m.toolCalls, { name: event.name, args: event.args, done: false }] };
              }));
              break;

            case "tool_result":
              setMessages(prev => prev.map(m => {
                if (m.id !== aId) return m;
                const calls = [...m.toolCalls];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i].name === event.name && !calls[i].done) {
                    calls[i] = { ...calls[i], result: event.data, done: true };
                    break;
                  }
                }
                return { ...m, toolCalls: calls };
              }));
              break;

            case "done":
              // Mark stream complete — do NOT invalidate queries yet, just stop streaming
              setMessages(prev => prev.map(m =>
                m.id === aId ? { ...m, streaming: false } : m
              ));
              setStreaming(false);
              // Refresh session list + messages after a short delay
              // so the server has time to commit the assistant message
              setTimeout(() => {
                qc.invalidateQueries({ queryKey: ["chat-sessions"] });
                qc.invalidateQueries({ queryKey: ["chat-messages", finalSessionId] });
              }, 800);
              break;

            case "error":
              setMessages(prev => prev.map(m =>
                m.id === aId ? { ...m, streaming: false, error: event.message } : m
              ));
              setStreaming(false);
              break;
          }
        },
        abortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages(prev => prev.map(m =>
          m.id === aId ? { ...m, streaming: false, error: "Connection error. Please try again." } : m
        ));
      }
      setStreaming(false);
    }
  }, [qc]);

  // ── Keyboard handler ───────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = sessions.filter(s => s.title.toLowerCase().includes(searchTerm.toLowerCase()));
  const isEmpty = messages.length === 0;
  const currentSession = sessions.find(s => s.id === activeSessionId);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex overflow-hidden" style={{ height: "calc(100dvh - 56px)" }}>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside
        className={clsx(
          "flex-col shrink-0 z-30 transition-all duration-300",
          showSidebar ? "flex w-64" : "hidden lg:hidden",
        )}
        style={{
          background: "rgba(3,7,18,0.95)",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          backdropFilter: "blur(24px)",
        }}
      >
        {/* Logo + search */}
        <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg,#0891b2,#22d3ee)", boxShadow: "0 0 14px rgba(34,211,238,0.28)" }}>
              <Bot size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-none">Copilot</p>
              <p className="text-[10px] text-slate-500 mt-0.5">AI Inventory Assistant</p>
            </div>
            <button onClick={() => setShowSidebar(false)}
              className="ml-auto text-slate-600 hover:text-slate-400 transition-colors p-1 rounded-lg hover:bg-white/5 lg:hidden">
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <Search size={12} className="text-slate-600 shrink-0" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search chats…"
              className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-700 outline-none" />
          </div>
        </div>

        {/* New Chat button */}
        <div className="px-3 pt-3">
          <button onClick={newChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group"
            style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.14)", color: "#22d3ee" }}>
            <Plus size={14} />
            <span>New chat</span>
          </button>
        </div>

        {/* Chat history */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5 scrollbar-none">
          {filtered.length > 0 && (
            <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider px-1 mb-2">
              Recent chats
            </p>
          )}
          {filtered.map(s => (
            <div key={s.id}
              onClick={() => selectSession(s.id)}
              className={clsx(
                "group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all duration-100",
                activeSessionId === s.id ? "text-slate-200" : "text-slate-500 hover:text-slate-300",
              )}
              style={activeSessionId === s.id
                ? { background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.14)" }
                : { border: "1px solid transparent" }}>

              {editingId === s.id ? (
                <input autoFocus value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onBlur={() => renameSession(s.id, editTitle)}
                  onKeyDown={e => {
                    if (e.key === "Enter") renameSession(s.id, editTitle);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 bg-transparent text-xs text-slate-200 outline-none border-b border-brand-400/40" />
              ) : (
                <span className="flex-1 text-xs truncate">{s.title}</span>
              )}

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={e => { e.stopPropagation(); setEditingId(s.id); setEditTitle(s.title); }}
                  className="p-1 rounded-lg text-slate-700 hover:text-slate-300 hover:bg-white/5 transition-all">
                  <Edit3 size={10} />
                </button>
                <button onClick={e => { e.stopPropagation(); deleteSession.mutate(s.id); }}
                  className="p-1 rounded-lg text-slate-700 hover:text-red-400 hover:bg-red-400/5 transition-all">
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="py-10 flex flex-col items-center gap-2">
              <Bot size={22} className="text-slate-800" />
              <p className="text-[11px] text-slate-600 text-center">No chats yet.<br />Start a new conversation.</p>
            </div>
          )}
        </div>

        {/* KB button */}
        <div className="px-3 pb-4">
          <button onClick={() => setShowKB(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs transition-all"
            style={showKB
              ? { background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.15)", color: "#22d3ee" }
              : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "#64748b" }}>
            <FileText size={12} />
            <span>Knowledge Base</span>
            <ChevronRight size={11} className={clsx("ml-auto transition-transform", showKB && "rotate-180")} />
          </button>
        </div>
      </aside>

      {/* ── Chat area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(3,7,18,0.6)", backdropFilter: "blur(20px)" }}>

          <button onClick={() => setShowSidebar(v => !v)}
            className="text-slate-500 hover:text-slate-300 transition-colors p-1.5 rounded-lg hover:bg-white/5">
            <Menu size={17} />
          </button>

          <p className="text-sm font-medium text-slate-300 truncate flex-1">
            {currentSession?.title ?? (isEmpty ? "AI Inventory Copilot" : "Chat")}
          </p>

          <div ref={quotaAnchorRef} className="shrink-0">
            {chatRateLimit && (
              <>
                <button
                  type="button"
                  onClick={() => (quotaCardOpen ? closeQuotaCard() : openQuotaCard())}
                  onMouseEnter={() => openQuotaCard()}
                  onMouseLeave={() => setQuotaCardOpen(false)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[9px] font-semibold transition-all hover:bg-white/5"
                  style={{
                    background: quotaCardOpen ? "rgba(34,211,238,0.12)" : "rgba(34,211,238,0.08)",
                    border: "1px solid rgba(34,211,238,0.18)",
                    color: "#22d3ee",
                  }}
                  title="Click/hover for AI quota details"
                >
                  <Bot size={12} className="shrink-0" />
                  AI {chatRateLimit.remaining}/{chatRateLimit.limit}/min
                </button>

                {quotaCardOpen && quotaCardPos && (
                  <div
                    style={{
                      position: "fixed",
                      top: quotaCardPos.top,
                      left: quotaCardPos.left,
                      width: 300,
                      zIndex: 60,
                      background: "rgba(7,15,31,0.98)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
                      backdropFilter: "blur(24px)",
                      borderRadius: 16,
                    }}
                  >
                    <div style={{ padding: "14px 14px 10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                      <div className="flex items-center gap-2">
                        <Bot size={14} className="text-brand-400" />
                        <div className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>
                          AI Copilot quota
                        </div>
                        <div className="ml-auto text-[10px] font-semibold" style={{ color: "#22d3ee" }}>
                          live
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-slate-400">
                        Model:{" "}
                        <span className="text-slate-200 font-semibold">{chatRateLimit.model ?? "Gemini"}</span>
                      </div>
                    </div>

                    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div className="text-[12px]" style={{ color: "#94a3b8" }}>
                        Remaining: <span style={{ color: "#22d3ee", fontWeight: 700 }}>{chatRateLimit.remaining}</span> / {chatRateLimit.limit} per 60s
                      </div>

                      <div style={{ height: 8, background: "rgba(34,211,238,0.12)", borderRadius: 999, overflow: "hidden", border: "1px solid rgba(34,211,238,0.18)" }}>
                        <div
                          style={{
                            width: `${Math.round((chatRateLimit.used / Math.max(1, chatRateLimit.limit)) * 100)}%`,
                            height: "100%",
                            background: "linear-gradient(90deg,#0891b2,#22d3ee)",
                          }}
                        />
                      </div>

                      <div className="text-[11px]" style={{ color: "#94a3b8" }}>
                        Used: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{chatRateLimit.used}</span>
                        {" · "}
                        Next reset:{" "}
                        <span style={{ color: "#e2e8f0", fontWeight: 700 }}>
                          {chatRateLimit.retry_after_seconds > 0 ? `${chatRateLimit.retry_after_seconds}s` : "now"}
                        </span>
                      </div>

                      <div className="text-[10px]" style={{ color: "#64748b" }}>
                        Quota is enforced per IP to keep the copilot responsive under load.
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {streaming && (
            <button onClick={() => { abortRef.current?.abort(); setStreaming(false); setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m)); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
              <X size={11} />Stop
            </button>
          )}

          {!streaming && activeSessionId && (
            <button onClick={() => qc.invalidateQueries({ queryKey: ["chat-messages", activeSessionId] })}
              title="Refresh messages"
              className="text-slate-600 hover:text-slate-400 transition-colors p-1.5 rounded-lg hover:bg-white/5">
              <RefreshCw size={14} />
            </button>
          )}

          <button onClick={() => setShowKB(v => !v)}
            className={clsx(
              "hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all",
            )}
            style={showKB
              ? { background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.18)", color: "#22d3ee" }
              : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b" }}>
            <FileText size={12} />Knowledge Base
          </button>
        </div>

        {/* Messages or welcome */}
        <div className="flex-1 overflow-y-auto scroll-smooth">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                style={{
                  background: "linear-gradient(135deg,rgba(8,145,178,0.2),rgba(34,211,238,0.1))",
                  border: "1px solid rgba(34,211,238,0.18)",
                  boxShadow: "0 0 48px rgba(34,211,238,0.08)",
                }}>
                <Beaker size={26} className="text-brand-400" />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">Hi there</h2>
              <p className="text-slate-500 text-sm mb-8">Where should we start?</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                {SUGGESTIONS.map(({ icon: Icon, text, color }) => (
                  <button key={text} onClick={() => sendMessage(text)}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left text-sm font-medium transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}>
                    <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${color}14`, border: `1px solid ${color}28` }}>
                      <Icon size={14} style={{ color }} />
                    </div>
                    <span className="truncate">{text}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-800 mt-10">
                Reads live inventory · All actions audited
              </p>
            </div>
          ) : (
            <div className="px-4 py-5 max-w-3xl mx-auto w-full">
              {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
              <div ref={bottomRef} className="h-2" />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="shrink-0 px-4 pb-4 pt-2"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2.5 px-3.5 py-2.5 rounded-2xl transition-all duration-200"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: streaming
                  ? "1px solid rgba(34,211,238,0.22)"
                  : "1px solid rgba(255,255,255,0.09)",
                boxShadow: streaming ? "0 0 20px rgba(34,211,238,0.06)" : "none",
              }}>

              {/* Attach doc */}
              <label title="Upload document to Knowledge Base"
                className="text-slate-700 hover:text-brand-400 transition-colors cursor-pointer shrink-0 pb-0.5">
                <Paperclip size={17} />
                <input type="file" accept=".pdf,.docx,.txt,.md,.csv" className="hidden"
                  onChange={async e => {
                    const f = e.target.files?.[0];
                    if (f) { await chatApi.uploadDocument(f); qc.invalidateQueries({ queryKey: ["chat-docs"] }); }
                    e.target.value = "";
                  }} />
              </label>

              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={e => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
                }}
                onKeyDown={onKeyDown}
                disabled={streaming}
                placeholder={streaming ? "Thinking…" : "Ask anything about your lab inventory…"}
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-700 outline-none resize-none leading-relaxed"
                style={{ maxHeight: 140 }}
              />

              <button onClick={() => sendMessage(input)}
                disabled={!input.trim() || streaming}
                className={clsx(
                  "w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0",
                  input.trim() && !streaming
                    ? "hover:scale-105 active:scale-95"
                    : "opacity-35 cursor-not-allowed",
                )}
                style={input.trim() && !streaming
                  ? { background: "linear-gradient(135deg,#0891b2,#22d3ee)", boxShadow: "0 4px 14px rgba(34,211,238,0.35)" }
                  : { background: "rgba(255,255,255,0.06)" }}>
                <Send size={14} className="text-white" style={{ transform: "translateX(1px)" }} />
              </button>
            </div>
            <p className="text-[10px] text-slate-800 text-center mt-2">
              SEAR Lab Copilot · Reads live database · All actions are audited
            </p>
          </div>
        </div>
      </div>

      {/* ── KB Panel (desktop) ─────────────────────────────────────────────── */}
      {showKB && (
        <div className="hidden lg:block w-72 shrink-0">
          <KBPanel onClose={() => setShowKB(false)} />
        </div>
      )}

      {/* ── KB Panel (mobile overlay) ──────────────────────────────────────── */}
      {showKB && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button className="flex-1 bg-black/50" onClick={() => setShowKB(false)} />
          <div className="w-80 h-full"><KBPanel onClose={() => setShowKB(false)} /></div>
        </div>
      )}
    </div>
  );
}
