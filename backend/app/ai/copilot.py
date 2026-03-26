"""
AI Copilot orchestrator.

Implements an agentic loop using OpenAI's chat-completions API with
function/tool calling.  Yields Server-Sent Event (SSE) strings so the
FastAPI endpoint can stream them to the browser in real time.

SSE event types:
  {"type": "token",       "content": "…"}           – streaming text delta
  {"type": "tool_call",   "name": "…", "args": {…}} – LLM called a tool
  {"type": "tool_result", "name": "…", "data": {…}} – tool executed
  {"type": "done",        "message_id": 123}         – stream complete
  {"type": "error",       "message": "…"}            – unrecoverable error

If OPENAI_API_KEY is not configured the copilot falls back to a deterministic
rule-based responder that still calls the inventory tools.
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator, Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.tools import TOOL_SCHEMAS, WRITE_TOOLS, dispatch_tool
from app.core.config import settings

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the SEAR Lab Inventory Copilot — an expert AI assistant built directly into the laboratory inventory management system. You have live access to the inventory database through tool functions.

Your role:
- Answer questions about items, stock levels, locations, and transaction history using the provided tools.
- Perform inventory operations (stock in, stock out, transfer) when asked to.
- Identify low-stock items, overdue/idle equipment, and provide operational insights.
- Reference only data retrieved from tools — never make up item names, quantities, or locations.

Formatting rules:
- Use bullet points for lists of items or steps.
- Include specific numbers, SKUs, and location codes when reporting data.
- For write operations (stock in/out/transfer), always confirm what was done with a concise summary.
- Keep responses concise and actionable. Avoid long preambles.

Tool usage rules:
- Always search before acting: confirm item ID and location ID via search_inventory / list_locations before performing stock in, stock out, or transfer.
- If ambiguous (multiple matches), list them and ask the user to clarify.
- For bulk or potentially destructive operations, summarize the plan and note you are proceeding.
"""


def _sse(data: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data)}\n\n"


async def run_copilot(
    *,
    messages: list[dict],         # full OpenAI-format history
    db: AsyncSession,
    actor_id: int,
    actor_roles: list[str],
) -> AsyncIterator[str]:
    """
    Main agentic loop. Yields SSE strings.
    messages already include the system prompt prepended by the caller.
    """
    if not settings.OPENAI_API_KEY:
        async for chunk in _fallback_responder(messages, db, actor_id, actor_roles):
            yield chunk
        return

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    except ImportError:
        yield _sse({"type": "error", "message": "openai package not installed. Run: pip install openai"})
        return

    # Agentic loop — max 6 tool-call rounds to prevent infinite loops
    for _round in range(6):
        try:
            stream = await client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=messages,
                tools=TOOL_SCHEMAS,
                tool_choice="auto",
                stream=True,
                temperature=0.2,
            )
        except Exception as exc:
            log.exception("OpenAI API error: %s", exc)
            yield _sse({"type": "error", "message": f"LLM API error: {exc}"})
            return

        # Accumulate the streamed response
        accumulated_content = ""
        accumulated_tool_calls: list[dict] = []
        current_tool: dict | None = None

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None:
                continue

            # Text token
            if delta.content:
                accumulated_content += delta.content
                yield _sse({"type": "token", "content": delta.content})

            # Tool call delta
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    while len(accumulated_tool_calls) <= idx:
                        accumulated_tool_calls.append({"id": "", "name": "", "args": ""})
                    if tc.id:
                        accumulated_tool_calls[idx]["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            accumulated_tool_calls[idx]["name"] += tc.function.name
                        if tc.function.arguments:
                            accumulated_tool_calls[idx]["args"] += tc.function.arguments

        # No tool calls → conversation is done
        if not accumulated_tool_calls:
            break

        # Build assistant message with tool_calls for history
        assistant_msg: dict[str, Any] = {"role": "assistant", "content": accumulated_content or None}
        assistant_msg["tool_calls"] = [
            {
                "id": tc["id"],
                "type": "function",
                "function": {"name": tc["name"], "arguments": tc["args"]},
            }
            for tc in accumulated_tool_calls
        ]
        messages.append(assistant_msg)

        # Execute each tool call
        for tc in accumulated_tool_calls:
            tool_name = tc["name"]
            try:
                args = json.loads(tc["args"] or "{}")
            except json.JSONDecodeError:
                args = {}

            yield _sse({"type": "tool_call", "name": tool_name, "args": args})

            try:
                result = await dispatch_tool(
                    name=tool_name,
                    args=args,
                    db=db,
                    actor_id=actor_id,
                    actor_roles=actor_roles,
                    role_names=actor_roles,
                )
            except Exception as exc:
                result = {"error": str(exc)}

            yield _sse({"type": "tool_result", "name": tool_name, "data": result})

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(result),
            })

    # Signal completion (message_id is assigned by the API layer)
    yield _sse({"type": "done"})


# ── Fallback: no OpenAI key ───────────────────────────────────────────────────

async def _fallback_responder(
    messages: list[dict],
    db: AsyncSession,
    actor_id: int,
    actor_roles: list[str],
) -> AsyncIterator[str]:
    """
    Rule-based fallback when no OpenAI API key is configured.
    Detects intent from the last user message and calls appropriate tools.
    """
    last_user = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"),
        "",
    )
    text = (last_user or "").lower()

    # Dispatch based on keywords
    if any(k in text for k in ["low stock", "low-stock", "running out", "reorder", "shortage"]):
        yield _sse({"type": "tool_call", "name": "list_low_stock_items", "args": {}})
        result = await dispatch_tool("list_low_stock_items", {}, db, actor_id, actor_roles, actor_roles)
        yield _sse({"type": "tool_result", "name": "list_low_stock_items", "data": result})
        count = result.get("total", 0)
        items = result.get("items", [])
        response = f"**{count} items are at or below reorder level:**\n\n"
        for it in items[:10]:
            response += f"- **{it['name']}** ({it['sku']}): {it['current_stock']} {it['unit']} remaining (reorder at {it['reorder_level']})\n"
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})

    elif any(k in text for k in ["summary", "overview", "dashboard", "how many", "total", "status"]):
        yield _sse({"type": "tool_call", "name": "get_dashboard_summary", "args": {}})
        result = await dispatch_tool("get_dashboard_summary", {}, db, actor_id, actor_roles, actor_roles)
        yield _sse({"type": "tool_result", "name": "get_dashboard_summary", "data": result})
        response = (
            f"**Inventory Overview**\n\n"
            f"- **Total SKUs:** {result.get('total_skus', 0)}\n"
            f"- **Low stock items:** {result.get('low_stock_items', 0)}\n"
            f"- **Transactions today:** {result.get('transactions_today', 0)}\n"
            f"- **Total locations:** {result.get('total_locations', 0)}\n"
        )
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})

    elif any(k in text for k in ["overdue", "unused", "idle", "sitting", "not used"]):
        yield _sse({"type": "tool_call", "name": "list_overdue_items", "args": {"days_unused": 90}})
        result = await dispatch_tool("list_overdue_items", {"days_unused": 90}, db, actor_id, actor_roles, actor_roles)
        yield _sse({"type": "tool_result", "name": "list_overdue_items", "data": result})
        count = result.get("total", 0)
        items = result.get("items", [])
        response = f"**{count} items unused for 90+ days:**\n\n"
        for it in items[:10]:
            response += f"- **{it['name']}** ({it['sku']}): {it['total_quantity']} {it['unit']} on hand\n"
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})

    elif any(k in text for k in ["transaction", "history", "recent", "last", "activity"]):
        yield _sse({"type": "tool_call", "name": "get_transaction_history", "args": {"limit": 10}})
        result = await dispatch_tool("get_transaction_history", {"limit": 10}, db, actor_id, actor_roles, actor_roles)
        yield _sse({"type": "tool_result", "name": "get_transaction_history", "data": result})
        transactions = result.get("transactions", [])
        response = "**Recent Transactions:**\n\n"
        for t in transactions[:10]:
            response += f"- {t['event_kind']} — **{t['item_name']}** × {t['quantity']} by {t['actor']} ({t['occurred_at'][:10]})\n"
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})

    else:
        # Generic search
        words = [w for w in text.split() if len(w) > 2]
        query = " ".join(words[:5]) if words else "item"
        yield _sse({"type": "tool_call", "name": "search_inventory", "args": {"query": query}})
        result = await dispatch_tool("search_inventory", {"query": query}, db, actor_id, actor_roles, actor_roles)
        yield _sse({"type": "tool_result", "name": "search_inventory", "data": result})
        items = result.get("items", [])
        if items:
            response = f"**Found {result['total']} items matching '{query}':**\n\n"
            for it in items[:8]:
                response += f"- **{it['name']}** ({it['sku']}): {it['total_quantity']} {it['unit']} on hand\n"
        else:
            response = (
                f"I couldn't find any items matching '{query}'. "
                "Try a different keyword, or ask me to show low-stock items, recent transactions, or the dashboard summary."
            )
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})

    yield _sse({"type": "done"})


def _chunk_text(text: str, size: int = 4) -> list[str]:
    """Split text into small chunks to simulate streaming."""
    return [text[i : i + size] for i in range(0, len(text), size)]
