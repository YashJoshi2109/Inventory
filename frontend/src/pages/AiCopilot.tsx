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
  type ChatMessage,
  type SseEvent,
  type KnowledgeDocument,
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
} from "lucide-react";
import { clsx } from "clsx";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: Record<string, unknown> }>;
  streaming?: boolean;
  error?: string;
}

interface ToolCallCard {
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  loading: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  search_inventory:      { label: "Searching inventory",      color: "#22d3ee", bg: "rgba(34,211,238,0.1)" },
  get_item_details:      { label: "Fetching item details",    color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  get_location_contents: { label: "Checking location",        color: "#34d399", bg: "rgba(52,211,153,0.1)" },
  list_low_stock_items:  { label: "Checking stock levels",    color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  list_overdue_items:    { label: "Finding idle items",       color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  get_dashboard_summary: { label: "Loading dashboard",        color: "#60a5fa", bg: "rgba(96,165,250,0.1)" },
  perform_stock_in:      { label: "Adding stock",             color: "#34d399", bg: "rgba(52,211,153,0.1)" },
  perform_stock_out:     { label: "Removing stock",           color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  perform_transfer:      { label: "Transferring item",        color: "#c084fc", bg: "rgba(192,132,252,0.1)" },
  list_locations:        { label: "Loading locations",        color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  get_transaction_history: { label: "Loading transactions",   color: "#60a5fa", bg: "rgba(96,165,250,0.1)" },
};

const SUGGESTED_PROMPTS = [
  { icon: BarChart3,   text: "Show inventory overview",          color: "#60a5fa" },
  { icon: TrendingDown,text: "What items are running low?",      color: "#fbbf24" },
  { icon: Clock,       text: "Find items unused for 90 days",    color: "#fb923c" },
  { icon: Package,     text: "Search for Arduino kits",          color: "#22d3ee" },
  { icon: MapPin,      text: "What's in Embedded Lab?",          color: "#34d399" },
  { icon: Zap,         text: "Show recent transactions",         color: "#a78bfa" },
];

const DOC_TYPES = ["general", "sop", "manual", "calibration", "invoice", "policy", "maintenance"];

// ── Sub-components ────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{
            background: "#22d3ee",
            animationDelay: `${i * 0.15}s`,
            animationDuration: "0.8s",
          }}
        />
      ))}
    </div>
  );
}

function ToolCallBadge({ call }: { call: ToolCallCard }) {
  const meta = TOOL_LABELS[call.name] ?? { label: call.name, color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };
  const resultError = call.result && "error" in call.result ? call.result.error : undefined;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs my-1"
      style={{ background: meta.bg, border: `1px solid ${meta.color}25` }}
    >
      {call.loading ? (
        <Loader2 size={12} className="animate-spin shrink-0" style={{ color: meta.color }} />
      ) : resultError ? (
        <AlertCircle size={12} className="shrink-0" style={{ color: "#f87171" }} />
      ) : (
        <CheckCircle2 size={12} className="shrink-0" style={{ color: meta.color }} />
      )}
      <span style={{ color: meta.color }} className="font-medium">{meta.label}</span>
      {!call.loading && call.result && !resultError && (
        <span className="text-slate-500 ml-auto">
          {"total" in call.result && call.result.total !== undefined ? `${call.result.total} results` :
           "success" in call.result && call.result.success ? "Done" : "✓"}
        </span>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: LocalMessage }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div
          className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-sm text-sm text-white leading-relaxed"
          style={{
            background: "linear-gradient(135deg, #0891b2, #22d3ee)",
            boxShadow: "0 4px 20px rgba(34,211,238,0.25)",
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-4">
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{
          background: "linear-gradient(135deg, rgba(8,145,178,0.3), rgba(34,211,238,0.15))",
          border: "1px solid rgba(34,211,238,0.2)",
        }}
      >
        <Bot size={14} className="text-brand-400" />
      </div>
      <div className="flex-1 min-w-0">
        {/* Tool call badges */}
        {msg.toolCalls.map((tc, i) => (
          <ToolCallBadge
            key={i}
            call={{ ...tc, loading: !!(msg.streaming && i === msg.toolCalls.length - 1 && !tc.result) }}
          />
        ))}

        {/* Text content */}
        {(msg.content || msg.streaming) && (
          <div
            className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-slate-200 leading-relaxed"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {msg.streaming && !msg.content ? (
              <TypingDots />
            ) : (
              <div className="prose prose-invert prose-sm max-w-none [&>ul]:my-1 [&>ol]:my-1 [&>p]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {msg.error && (
          <div
            className="px-4 py-3 rounded-2xl text-sm"
            style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}
          >
            {msg.error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Document panel ────────────────────────────────────────────────────────────

function DocPanel({ onClose }: { onClose: () => void }) {
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
      await chatApi.uploadDocument(file, docType);
      await qc.invalidateQueries({ queryKey: ["chat-docs"] });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: number) => {
    await chatApi.deleteDocument(id);
    await qc.invalidateQueries({ queryKey: ["chat-docs"] });
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: "rgba(7,15,31,0.97)",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-brand-400" />
          <span className="text-sm font-semibold text-slate-200">Knowledge Base</span>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className="w-full text-xs rounded-xl px-3 py-2 text-slate-300 bg-transparent outline-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {DOC_TYPES.map((t) => (
            <option key={t} value={t} className="bg-slate-900">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{
            background: "linear-gradient(135deg, rgba(8,145,178,0.3), rgba(34,211,238,0.15))",
            border: "1px solid rgba(34,211,238,0.25)",
            color: "#22d3ee",
          }}
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {uploading ? "Uploading…" : "Upload Document"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv"
          className="hidden"
          onChange={upload}
        />
        <p className="text-[10px] text-slate-600 text-center">PDF, DOCX, TXT, MD, CSV</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {isLoading && <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-slate-600" /></div>}
        {docs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-start gap-2 p-3 rounded-xl group"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <FileText size={14} className="text-brand-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{doc.title}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">
                {doc.doc_type} · {doc.chunk_count} chunks ·{" "}
                <span style={{ color: doc.status === "ready" ? "#34d399" : doc.status === "failed" ? "#f87171" : "#fbbf24" }}>
                  {doc.status}
                </span>
              </p>
            </div>
            <button
              onClick={() => remove(doc.id)}
              className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {docs.length === 0 && !isLoading && (
          <p className="text-xs text-slate-600 text-center py-4">
            No documents yet. Upload SOPs, manuals, or calibration records.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AiCopilot() {
  const qc = useQueryClient();

  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: sessions = [] } = useQuery({
    queryKey: ["chat-sessions"],
    queryFn: chatApi.listSessions,
    refetchInterval: 30_000,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["chat-messages", activeSessionId],
    queryFn: () => (activeSessionId ? chatApi.getMessages(activeSessionId) : Promise.resolve([])),
    enabled: !!activeSessionId,
  });

  // Sync persisted messages to local state
  useEffect(() => {
    if (history.length > 0) {
      const mapped: LocalMessage[] = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: String(m.id),
          role: m.role as "user" | "assistant",
          content: m.content ?? "",
          toolCalls: [],
        }));
      setMessages(mapped);
    } else {
      setMessages([]);
    }
  }, [history]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    onSuccess: (_, deletedId) => {
      qc.invalidateQueries({ queryKey: ["chat-sessions"] });
      if (activeSessionId === deletedId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    },
  });

  const renameSession = async (id: number, title: string) => {
    await chatApi.renameSession(id, title);
    qc.invalidateQueries({ queryKey: ["chat-sessions"] });
    setEditingId(null);
  };

  const startNewChat = useCallback(() => {
    createSession.mutate("New chat");
  }, [createSession]);

  const selectSession = (id: number) => {
    if (streaming) {
      abortRef.current?.abort();
      setStreaming(false);
    }
    setActiveSessionId(id);
    setMessages([]);
  };

  const sendMessage = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || streaming) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      const session = await chatApi.createSession(content.slice(0, 60));
      qc.invalidateQueries({ queryKey: ["chat-sessions"] });
      sessionId = session.id;
      setActiveSessionId(session.id);
    }

    setInput("");
    const userMsgId = `u-${Date.now()}`;
    const asstMsgId = `a-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content, toolCalls: [] },
      { id: asstMsgId, role: "assistant", content: "", toolCalls: [], streaming: true },
    ]);

    setStreaming(true);
    abortRef.current = new AbortController();

    let accContent = "";

    try {
      await chatApi.streamMessage(
        sessionId,
        content,
        (event: SseEvent) => {
          if (event.type === "token") {
            accContent += event.content;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId ? { ...m, content: accContent } : m
              )
            );
          } else if (event.type === "tool_call") {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== asstMsgId) return m;
                return {
                  ...m,
                  toolCalls: [...m.toolCalls, { name: event.name, args: event.args }],
                };
              })
            );
          } else if (event.type === "tool_result") {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== asstMsgId) return m;
                // attach result to the last matching tool call
                const calls = [...m.toolCalls];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i].name === event.name && !calls[i].result) {
                    calls[i] = { ...calls[i], result: event.data };
                    break;
                  }
                }
                return { ...m, toolCalls: calls };
              })
            );
          } else if (event.type === "done" || event.type === "error") {
            const errMsg = event.type === "error" ? event.message : undefined;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? { ...m, streaming: false, error: errMsg }
                  : m
              )
            );
            setStreaming(false);
            qc.invalidateQueries({ queryKey: ["chat-sessions"] });
            qc.invalidateQueries({ queryKey: ["chat-messages", sessionId] });
          }
        },
        abortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstMsgId
              ? { ...m, streaming: false, error: "Connection error. Please try again." }
              : m
          )
        );
      }
      setStreaming(false);
    }
  }, [activeSessionId, streaming, qc]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isEmpty = messages.length === 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full" style={{ height: "calc(100dvh - 56px)" }}>

      {/* ── Left Sidebar ─────────────────────────────────────────── */}
      <aside
        className={clsx(
          "flex-col shrink-0 transition-all duration-300 overflow-hidden",
          showSidebar ? "flex w-72" : "hidden",
          "lg:flex",
          !showSidebar && "lg:hidden",
        )}
        style={{
          background: "rgba(3,7,18,0.9)",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* Header */}
        <div className="px-4 pt-5 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2 mb-4">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #0891b2, #22d3ee)",
                boxShadow: "0 0 16px rgba(34,211,238,0.3)",
              }}
            >
              <Bot size={15} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-none">Copilot</p>
              <p className="text-[10px] text-slate-500 mt-0.5">AI Inventory Assistant</p>
            </div>
          </div>

          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <Search size={13} className="text-slate-500 shrink-0" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search chats"
              className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none"
            />
          </div>
        </div>

        {/* New Chat */}
        <div className="px-3 pt-3">
          <button
            onClick={startNewChat}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group"
            style={{
              background: "rgba(34,211,238,0.07)",
              border: "1px solid rgba(34,211,238,0.15)",
              color: "#22d3ee",
            }}
          >
            <Plus size={15} />
            New chat
          </button>
        </div>

        {/* Chat history */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5 scrollbar-none">
          {filteredSessions.length > 0 && (
            <p className="text-[10px] font-medium text-slate-600 uppercase tracking-wider px-1 mb-1.5">
              Recent chats
            </p>
          )}
          {filteredSessions.map((session) => (
            <div
              key={session.id}
              className={clsx(
                "group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150",
                activeSessionId === session.id
                  ? "text-slate-200"
                  : "text-slate-500 hover:text-slate-300",
              )}
              style={
                activeSessionId === session.id
                  ? { background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }
                  : { border: "1px solid transparent" }
              }
              onClick={() => selectSession(session.id)}
            >
              {editingId === session.id ? (
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => renameSession(session.id, editTitle)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") renameSession(session.id, editTitle);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 bg-transparent text-xs text-slate-200 outline-none border-b border-brand-400/50"
                />
              ) : (
                <span className="flex-1 text-xs truncate">{session.title}</span>
              )}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(session.id);
                    setEditTitle(session.title);
                  }}
                  className="p-1 rounded-lg text-slate-600 hover:text-slate-300 transition-colors"
                >
                  <Edit3 size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession.mutate(session.id);
                  }}
                  className="p-1 rounded-lg text-slate-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}

          {filteredSessions.length === 0 && (
            <div className="py-8 flex flex-col items-center gap-2">
              <Bot size={24} className="text-slate-700" />
              <p className="text-xs text-slate-600 text-center">No chats yet. Start a conversation.</p>
            </div>
          )}
        </div>

        {/* Docs button */}
        <div className="px-3 pb-4">
          <button
            onClick={() => setShowDocs(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs text-slate-500 hover:text-slate-300 transition-colors"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <FileText size={13} />
            Knowledge Base
            <ChevronRight size={12} className="ml-auto" />
          </button>
        </div>
      </aside>

      {/* ── Main Chat Area ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden relative">

        {/* Top bar */}
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <button
            onClick={() => setShowSidebar((v) => !v)}
            className="text-slate-500 hover:text-slate-300 transition-colors lg:hidden"
          >
            <Menu size={18} />
          </button>
          <button
            onClick={() => setShowSidebar((v) => !v)}
            className="text-slate-500 hover:text-slate-300 transition-colors hidden lg:block"
          >
            <Menu size={18} />
          </button>

          {activeSessionId && (
            <p className="text-sm font-medium text-slate-300 truncate flex-1">
              {sessions.find((s) => s.id === activeSessionId)?.title ?? "Chat"}
            </p>
          )}

          <button
            onClick={() => setShowDocs((v) => !v)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ml-auto",
              showDocs
                ? "text-brand-400"
                : "text-slate-500 hover:text-slate-300",
            )}
            style={
              showDocs
                ? { background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)" }
                : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
            }
          >
            <FileText size={13} />
            <span className="hidden sm:inline">Knowledge Base</span>
          </button>

          {streaming && (
            <button
              onClick={() => {
                abortRef.current?.abort();
                setStreaming(false);
                setMessages((prev) =>
                  prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
                );
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-red-400 transition-all"
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}
            >
              <X size={12} />
              Stop
            </button>
          )}
        </div>

        {/* Messages / Welcome */}
        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (
            /* Welcome screen */
            <div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
                style={{
                  background: "linear-gradient(135deg, rgba(8,145,178,0.25), rgba(34,211,238,0.12))",
                  border: "1px solid rgba(34,211,238,0.2)",
                  boxShadow: "0 0 40px rgba(34,211,238,0.1)",
                }}
              >
                <Beaker size={28} className="text-brand-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-1">
                Hi there
              </h2>
              <p className="text-slate-400 text-sm mb-8">
                Where should we start?
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTED_PROMPTS.map(({ icon: Icon, text, color }) => (
                  <button
                    key={text}
                    onClick={() => sendMessage(text)}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left text-sm font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.09)",
                      color: "#94a3b8",
                    }}
                  >
                    <div
                      className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${color}18`, border: `1px solid ${color}30` }}
                    >
                      <Icon size={14} style={{ color }} />
                    </div>
                    <span className="truncate">{text}</span>
                  </button>
                ))}
              </div>

              <p className="text-xs text-slate-700 mt-8">
                Powered by SEAR Lab Inventory · AI Copilot
              </p>
            </div>
          ) : (
            <div className="px-4 py-4 max-w-3xl mx-auto w-full">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div
          className="shrink-0 px-4 pb-4 pt-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="max-w-3xl mx-auto">
            <div
              className="flex items-end gap-3 px-4 py-3 rounded-2xl transition-all"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: streaming
                  ? "1px solid rgba(34,211,238,0.25)"
                  : "1px solid rgba(255,255,255,0.09)",
                boxShadow: streaming ? "0 0 20px rgba(34,211,238,0.08)" : "none",
              }}
            >
              <label
                htmlFor="doc-upload-inline"
                className="text-slate-600 hover:text-brand-400 transition-colors cursor-pointer shrink-0 pb-0.5"
                title="Upload document"
              >
                <Paperclip size={18} />
                <input
                  id="doc-upload-inline"
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      await chatApi.uploadDocument(file);
                      qc.invalidateQueries({ queryKey: ["chat-docs"] });
                    }
                    e.target.value = "";
                  }}
                />
              </label>

              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder={streaming ? "AI is thinking…" : "Ask anything about your lab inventory…"}
                disabled={streaming}
                rows={1}
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none resize-none leading-relaxed"
                style={{ maxHeight: 140 }}
              />

              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || streaming}
                className={clsx(
                  "w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0 pb-0",
                  input.trim() && !streaming
                    ? "text-white scale-100 hover:scale-105"
                    : "text-slate-600 opacity-40 cursor-not-allowed",
                )}
                style={
                  input.trim() && !streaming
                    ? {
                        background: "linear-gradient(135deg, #0891b2, #22d3ee)",
                        boxShadow: "0 4px 16px rgba(34,211,238,0.4)",
                      }
                    : { background: "rgba(255,255,255,0.06)" }
                }
              >
                <Send size={16} />
              </button>
            </div>

            <p className="text-[10px] text-slate-700 text-center mt-2">
              SEAR Lab Copilot · Reads live inventory · All actions are audited
            </p>
          </div>
        </div>
      </div>

      {/* ── Knowledge Base Panel ───────────────────────────────── */}
      {showDocs && (
        <div className="w-72 shrink-0 hidden lg:block">
          <DocPanel onClose={() => setShowDocs(false)} />
        </div>
      )}

      {/* Mobile: doc panel as overlay */}
      {showDocs && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button className="flex-1" onClick={() => setShowDocs(false)} />
          <div className="w-80 h-full">
            <DocPanel onClose={() => setShowDocs(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
