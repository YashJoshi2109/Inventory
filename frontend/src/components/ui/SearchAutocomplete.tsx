import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Package } from "lucide-react";
import { aiApi } from "@/api/transactions";
import { useDebounce } from "@/hooks/useDebounce";

interface SearchHit {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  total_quantity: number;
  unit: string;
  score: number;
}

interface SearchAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (hit: SearchHit) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  minChars?: number;
}

export function SearchAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Search…",
  className = "",
  style,
  minChars = 3,
}: SearchAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(value, 300);

  const { data } = useQuery({
    queryKey: ["autocomplete", debounced],
    queryFn: () => aiApi.search(debounced),
    enabled: debounced.length >= minChars,
    staleTime: 30_000,
  });

  const hits = (data?.hits ?? []) as SearchHit[];
  const showDropdown = focused && open && debounced.length >= minChars && hits.length > 0;

  useEffect(() => {
    if (debounced.length >= minChars) setOpen(true);
    else setOpen(false);
  }, [debounced, minChars]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = useCallback((hit: SearchHit) => {
    onChange(hit.name);
    onSelect?.(hit);
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  }, [onChange, onSelect]);

  return (
    <div ref={containerRef} className="relative" style={{ position: "relative" }}>
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--text-muted)" }}
        />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          className={`w-full pl-9 pr-8 py-2.5 text-sm rounded-lg placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 ${className}`}
          style={{
            background: "var(--bg-input)",
            border: "1px solid var(--border-card)",
            color: "var(--text-primary)",
            ...style,
          }}
        />
        {value && (
          <button
            className="absolute right-2.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
            onMouseDown={(e) => { e.preventDefault(); onChange(""); setOpen(false); }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          className="absolute z-50 w-full mt-1 rounded-xl overflow-hidden"
          style={{
            background: "var(--bg-card-solid)",
            border: "1px solid var(--border-card)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <div
            className="px-3 py-1.5 text-[10px] uppercase tracking-wide"
            style={{
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border-subtle)",
              background: "var(--bg-card)",
            }}
          >
            {data?.total} match{data?.total !== 1 ? "es" : ""}
          </div>
          {hits.slice(0, 8).map((hit, i) => (
            <button
              key={hit.id}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
              style={{
                borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                color: "var(--text-primary)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(hit); }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <Package size={12} style={{ color: "var(--accent)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {hit.name}
                </p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {hit.sku}
                  {hit.category ? ` · ${hit.category}` : ""}
                  {" · "}{hit.total_quantity} {hit.unit}
                </p>
              </div>
              <span
                className="text-[10px] font-mono shrink-0"
                style={{ color: "var(--accent-violet)" }}
              >
                {(hit.score * 100).toFixed(0)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
