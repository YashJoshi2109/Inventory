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
import re
from typing import AsyncIterator, Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.tools import TOOL_SCHEMAS, WRITE_TOOLS, dispatch_tool
from app.core.config import settings

log = logging.getLogger(__name__)

# Module-level client caches — avoids per-request client construction which
# adds ~50-100ms latency and burns extra CPU on every copilot call.
_gemini_client: Any = None
_openrouter_client: Any = None
_openai_client: Any = None


def _get_gemini_client() -> Any:
    """Return a cached Gemini client, creating it once on first call."""
    global _gemini_client
    if _gemini_client is None:
        from google import genai
        _gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _gemini_client


def _get_openrouter_client() -> Any:
    """Return a cached OpenRouter client (OpenAI-compatible), creating it once on first call."""
    global _openrouter_client
    if _openrouter_client is None:
        from openai import AsyncOpenAI
        _openrouter_client = AsyncOpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://sear-lab-inventory.app",
                "X-Title": "SEAR Lab Inventory Copilot",
            },
        )
    return _openrouter_client


def _get_openai_client() -> Any:
    """Return a cached OpenAI client, creating it once on first call."""
    global _openai_client
    if _openai_client is None:
        from openai import AsyncOpenAI
        _openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai_client


SYSTEM_PROMPT = """You are the SEAR Lab Inventory Copilot — an expert AI assistant built directly into the laboratory inventory management system. You have live access to the inventory database through tool functions.

Your role:
- Answer questions about items, stock levels, locations, and transaction history using the provided tools.
- For SOPs, manuals, warranties, calibration records, maintenance logs, invoices, policies, spreadsheets, CSV files, PDFs, and any uploaded documents: use `rag_search_docs` to retrieve relevant grounded chunks, then answer using those chunks.
- When a user asks about a file they uploaded or mentions its filename, ALWAYS call `rag_search_docs` first with the filename or topic as the query.
- If the user says "I already uploaded it", "check the file", "look in knowledge base", or similar — immediately call `rag_search_docs`.
- Perform inventory operations (stock in, stock out, transfer, create, update, delete) when asked to.
- Identify low-stock items, overdue/idle equipment, and provide operational insights.
- Reference only data retrieved from tools — never make up item names, quantities, or locations.
- If the user sends an image, analyze it to identify items, barcodes, or damage and relate it to the inventory.

Location queries (IMPORTANT):
- When the user mentions a shelf, rack, bin, location, area, or a code like "A1", "B-03", "shelf A1", "rack 2":
  call `get_location_contents` with that code, NOT `search_inventory`.
- Location codes follow patterns like A1, A-01, B2, SHELF-A1, RACK-B, BIN-01.
- If `get_location_contents` returns not-found: call `list_locations`, then call `ask_user` with component="checkbox",
  options = all available location codes (value=code, label="code — name"), context="location_select".
  Do NOT just list locations as text — always use `ask_user` so the user can click to select.

Interactive clarification (ask_user tool):
- Whenever user intent is ambiguous (wrong location, multiple item matches, unclear category), call `ask_user`.
- For single-choice disambiguation (which exact item?): component="radio".
- For multi-location operations (stock across multiple locations): component="checkbox".
- For category selection: call `list_categories` first, then `ask_user` with component="radio", context="category_select".
- The `ask_user` tool emits an interactive UI widget to the user and stops streaming — the user's selection
  arrives as a follow-up message. You do NOT need to write anything after calling `ask_user`.

CRUD operations (full coverage — items, categories, locations, stock):
- Items: `create_item` / `update_item` / `delete_item`. For create/update, call `list_categories` first if a category_id is needed.
- Categories: `create_category` / `update_category` / `delete_category`. Names must be unique. Deleting a category clears the FK on its items (they become uncategorized).
- Locations: `create_location` / `update_location` / `delete_location`. A new location needs a parent `area_id` or `area_code` — call `list_locations` first to see what areas exist. Hard-delete is blocked when stock is still stored at the location.
- Stock movements: `perform_stock_in` / `perform_stock_out` / `perform_transfer`. Always resolve item_id + location_id via `search_inventory` and `list_locations` first.
- Always confirm destructive actions (delete, hard_delete) before calling.
- All write tools are rate-limited per user (30/min, 200/hour). If you get `rate_limited: true`, stop and tell the user to retry later.

Formatting rules:
- Use bullet points for lists of items or steps.
- Include specific numbers, SKUs, and location codes when reporting data.
- For write operations, always confirm what was done with a concise summary.
- Keep responses concise and actionable. Avoid long preambles.

Tool usage rules:
- Always search before acting: confirm item ID and location ID via search_inventory / list_locations before performing stock in, stock out, or transfer.
- If ambiguous (multiple matches), list them and ask the user to clarify.
- For bulk or potentially destructive operations, summarize the plan and note you are proceeding.
- If the user asks about SOPs/manuals/warranties/calibration records/maintenance logs/invoices/policies/spreadsheets/CSV files/templates or storage conditions (temperature/PPE): you MUST call `rag_search_docs` first and answer using the returned chunks.
- If KNOWLEDGE BASE CONTEXT is already injected in the conversation (prefixed with [KNOWLEDGE BASE]), use it directly to answer — do NOT say "please upload the file".
"""


def _sse(data: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data)}\n\n"


async def run_copilot(
    *,
    messages: list[dict],         # full OpenAI-format history
    db: AsyncSession | None,      # None = open a fresh session per tool call
    actor_id: int,
    actor_roles: list[str],
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
) -> AsyncIterator[str]:
    """
    Main agentic loop. Yields SSE strings.
    messages already include the system prompt prepended by the caller.

    When db=None (streaming context) a fresh AsyncSession is opened per tool
    call so we are not dependent on the request-scoped session that was already
    committed before the stream started.

    Optional image_bytes / image_mime attach an image to the last user turn
    for vision-capable models (Gemini).
    """
    from app.core.database import AsyncSessionLocal

    async def _get_db():
        if db is not None:
            return db, False   # (session, should_close)
        s = AsyncSessionLocal()
        return s, True

    # ── RAG pre-injection (runs for ALL providers) ────────────────────────
    # Detect if the user query references uploaded documents and inject KB
    # context BEFORE the model sees the request.  This ensures even the
    # OpenRouter/OpenAI paths benefit from knowledge-base grounding.
    _last_user_msg = next((m for m in reversed(messages) if m.get("role") == "user"), None)
    _last_user_text: str = (_last_user_msg or {}).get("content") or ""
    _last_lower = _last_user_text.lower()

    _rag_keywords = [
        "sop", "manual", "warranty", "calibration", "maintenance", "invoice",
        "policy", "ppe", "temperature", "stored", "storage",
        "document", "upload", "file", "template", "spreadsheet", "csv", "pdf",
        "knowledge base", "sent", "already uploaded", "i uploaded", "check the",
        "items in", "what's in", "what is in", "contents of", "read the",
    ]
    _rag_intent = any(k in _last_lower for k in _rag_keywords)

    if not _rag_intent:
        # Check if any uploaded doc title/filename is mentioned in the query
        from app.core.database import AsyncSessionLocal as _ASL
        from app.models.chat import KnowledgeDocument as _KD
        from sqlalchemy import select as _sel
        _check_session = _ASL()
        try:
            _check_result = await _check_session.execute(
                _sel(_KD.title, _KD.filename).where(_KD.is_active == True)  # noqa: E712
            )
            for _title, _fname in _check_result.all():
                for _name in [_title or "", _fname or ""]:
                    _stem = re.sub(r'\.[a-zA-Z0-9]{1,5}$', '', _name.lower())
                    _stem = re.sub(r'[\s_\-]+', ' ', _stem).strip()
                    if len(_stem) > 3 and _stem in re.sub(r'[\s_\-]+', ' ', _last_lower):
                        _rag_intent = True
                        break
                if _rag_intent:
                    break
        except Exception:
            pass
        finally:
            await _check_session.close()

    _chunks: list[dict] = []
    _ctx_text = ""

    if _rag_intent:
        from app.ai.tools import rag_search_docs as _rag_fn
        _rag_session = AsyncSessionLocal()
        try:
            _rag_result = await _rag_fn(
                db=_rag_session,
                query=_last_user_text,
                limit=6,
            )
        except Exception:
            _rag_result = {}
        finally:
            await _rag_session.close()

        _chunks = _rag_result.get("chunks", [])
        if _chunks:
            _ctx_parts: list[str] = [
                "[KNOWLEDGE BASE — content retrieved from your uploaded documents]\n"
            ]
            for _ci, _ch in enumerate(_chunks, 1):
                _doc_title = _ch.get("doc_title") or _ch.get("doc_filename") or "Unknown"
                _dtype = _ch.get("doc_type", "general")
                _content = _ch.get("chunk_excerpt", "")
                _ctx_parts.append(
                    f'Document {_ci}: "{_doc_title}" (type: {_dtype})\n{_content}'
                )
            _ctx_parts.append(
                "\n[END KNOWLEDGE BASE]\n\n"
                "Use the document content above to answer the user's question accurately and completely."
            )
            _ctx_text = "\n\n---\n\n".join(_ctx_parts)

            # Prepend KB context into the last user message
            messages = list(messages)
            for _mi in range(len(messages) - 1, -1, -1):
                if messages[_mi].get("role") == "user":
                    _orig = messages[_mi].get("content") or ""
                    messages[_mi] = {
                        **messages[_mi],
                        "content": f"{_ctx_text}\n\nUser question: {_orig}",
                    }
                    break

    # ── Provider order ─────────────────────────────────────────────────────
    # Preferred chain: OpenRouter (primary) → Gemini → OpenAI (last).
    # Rationale: OpenRouter gives us multi-model routing and avoids Gemini
    # free-tier's aggressive 429s. OpenAI is kept last as a reliable safety net.
    # If no OPENROUTER_API_KEY is configured, we fall through to Gemini as
    # primary (legacy behavior) and then _openai_compat_fallback → OpenAI.
    if settings.OPENROUTER_API_KEY:
        # Stream directly — no buffering so SSE tokens reach the client immediately.
        # Only fall through to Gemini if OpenRouter fails BEFORE sending the first token.
        _started = False
        try:
            async for chunk in _run_openai_compat_loop(
                client=_get_openrouter_client(),
                model=settings.OPENROUTER_MODEL,
                messages=messages,
                get_db=_get_db,
                actor_id=actor_id,
                actor_roles=actor_roles,
            ):
                _started = True
                yield chunk
            return
        except Exception as exc:
            if _started:
                # Tokens already sent — gracefully terminate the stream.
                yield _sse({"type": "error", "message": "Connection to the AI service was interrupted. Please try again."})
                return
            log.warning("OpenRouter primary error (%s): falling through to Gemini/OpenAI", type(exc).__name__)

    # ── Secondary: Gemini (legacy primary path) ────────────────────────────
    if settings.GEMINI_API_KEY:
        try:
            from google.genai import types
        except ImportError:
            yield _sse({"type": "error", "message": "google-genai package not installed. Run: pip install google-genai"})
            return

        # Convert our OpenAI-style tool schemas to Gemini function declarations
        tool_decls: list[types.FunctionDeclaration] = []
        for schema in TOOL_SCHEMAS:
            fn = schema.get("function", {})
            tool_decls.append(
                types.FunctionDeclaration(
                    name=fn.get("name"),
                    description=fn.get("description", ""),
                    parameters=fn.get("parameters", {"type": "object", "properties": {}, "required": []}),
                )
            )

        gemini_tools = [types.Tool(function_declarations=tool_decls)]
        tool_config = types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(mode="AUTO"),
        )

        # Build Gemini conversation contents (exclude system message; use system_instruction instead)
        contents: list[types.Content] = []
        last_user_text = ""
        all_messages = [m for m in messages if m.get("role") != "system"]
        for i, m in enumerate(all_messages):
            role = m.get("role")
            if role == "user":
                last_user_text = m.get("content") or ""
                # Attach image to the last user message only
                is_last_user = (i == len(all_messages) - 1 or
                                not any(mm.get("role") == "user" for mm in all_messages[i+1:]))
                parts: list[Any] = [types.Part.from_text(text=m.get("content") or "")]
                if image_bytes and image_mime and is_last_user:
                    parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime))
                contents.append(types.Content(role="user", parts=parts))
            elif role == "assistant":
                contents.append(
                    types.Content(
                        role="model",
                        parts=[types.Part.from_text(text=m.get("content") or "")],
                    )
                )

        client = _get_gemini_client()

        # RAG context already pre-injected above (before provider selection).
        # For Gemini, also inject any pre-injected context into the contents list
        # so the model sees it in its native format.
        if _rag_intent and _chunks:
            contents.append(
                types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=_ctx_text)],
                )
            )
            contents.append(
                types.Content(
                    role="model",
                    parts=[types.Part.from_text(text="I have the knowledge base content. I'll answer using it.")],
                )
            )

        gemini_config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=gemini_tools,
            tool_config=tool_config,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )

        for _round in range(8):
            # ── Use streaming for text responses; accumulate for tool-call detection ──
            text_parts: list[str] = []
            seen_fc_keys: set[str] = set()
            collected_tool_calls: list[Any] = []
            last_candidate_content: Any = None
            stream_error: Exception | None = None

            try:
                _stream = await client.aio.models.generate_content_stream(
                    model=settings.GEMINI_CHAT_MODEL,
                    contents=contents,
                    config=gemini_config,
                )
                async for chunk in _stream:
                    # Stream text tokens immediately to the client
                    try:
                        t = chunk.text
                    except Exception:
                        t = None
                    if t:
                        text_parts.append(t)
                        yield _sse({"type": "token", "content": t})

                    # Collect candidate content for tool-call detection and history
                    if getattr(chunk, "candidates", None):
                        for cand in chunk.candidates:
                            cand_content = getattr(cand, "content", None)
                            if cand_content:
                                last_candidate_content = cand_content
                                for part in (getattr(cand_content, "parts", None) or []):
                                    fc = getattr(part, "function_call", None)
                                    if fc and getattr(fc, "name", None):
                                        # Deduplicate by (name, serialized args)
                                        try:
                                            fc_key = f"{fc.name}:{json.dumps(dict(fc.args or {}), sort_keys=True)}"
                                        except Exception:
                                            fc_key = fc.name
                                        if fc_key not in seen_fc_keys:
                                            seen_fc_keys.add(fc_key)
                                            collected_tool_calls.append(fc)

            except Exception as exc:
                stream_error = exc

            if stream_error is not None:
                log.warning("Gemini streaming error (%s): trying OpenRouter/OpenAI fallback", type(stream_error).__name__)
                async for chunk in _openai_compat_fallback(messages, _get_db, actor_id, actor_roles):
                    yield chunk
                return

            # Preserve model's turn for function-calling conversation continuity
            if last_candidate_content:
                contents.append(last_candidate_content)
            elif text_parts:
                contents.append(types.Content(
                    role="model",
                    parts=[types.Part.from_text(text="".join(text_parts))],
                ))

            # If no tool calls, text was already streamed — done
            if not collected_tool_calls:
                if not text_parts:
                    # Gemini returned nothing — route to fallback for a proper response
                    session_for_fb, close_fb = await _get_db()
                    try:
                        async for chunk in _fallback_responder(messages, session_for_fb, actor_id, actor_roles):
                            yield chunk
                    finally:
                        if close_fb:
                            await session_for_fb.commit()
                            await session_for_fb.close()
                    return
                break

            tool_calls = collected_tool_calls

            # Execute each requested tool call
            for fc in tool_calls:
                tool_name = fc.name
                try:
                    args = fc.args or {}
                except Exception:
                    args = {}

                yield _sse({"type": "tool_call", "name": tool_name, "args": args})

                tool_session, tool_should_close = await _get_db()
                try:
                    result = await dispatch_tool(
                        name=tool_name,
                        args=args,
                        db=tool_session,
                        actor_id=actor_id,
                        actor_roles=actor_roles,
                        role_names=actor_roles,
                    )
                    if tool_should_close:
                        await tool_session.commit()
                except Exception as exc:
                    result = {"error": str(exc)}
                finally:
                    if tool_should_close:
                        await tool_session.close()

                # ── ask_user tool (Gemini path) ────────────────────────────
                if isinstance(result, dict) and result.get("__interactive__"):
                    yield _sse({
                        "type": "interactive",
                        "component": result.get("component", "radio"),
                        "question": result.get("question", "Please select an option:"),
                        "options": result.get("options", []),
                        "context": result.get("context", "general"),
                    })
                    yield _sse({"type": "done"})
                    return

                yield _sse({"type": "tool_result", "name": tool_name, "data": result})

                # ── Interactive widget for Gemini path ─────────────────────
                if (
                    tool_name == "get_location_contents"
                    and isinstance(result, dict)
                    and "error" in result
                    and "not found" in str(result.get("error", "")).lower()
                ):
                    searched = (args.get("location_code") if isinstance(args, dict) else None) or "that location"
                    try:
                        loc_session2, loc_close2 = await _get_db()
                        try:
                            loc_list2 = await dispatch_tool(
                                name="list_locations",
                                args={"location_type": "rack"},
                                db=loc_session2,
                                actor_id=actor_id,
                                actor_roles=actor_roles,
                                role_names=actor_roles,
                            )
                            if loc_close2:
                                await loc_session2.commit()
                        finally:
                            if loc_close2:
                                await loc_session2.close()

                        locs2 = loc_list2.get("locations", [])
                        if locs2:
                            options2 = [
                                {"value": l["code"], "label": f"{l['code']} — {l['name']}"}
                                for l in sorted(locs2, key=lambda x: x.get("code", ""))[:20]
                            ]
                            yield _sse({
                                "type": "interactive",
                                "component": "checkbox",
                                "question": f"Location '{searched}' not found. Which location(s) did you mean?",
                                "options": options2,
                                "context": "location_select",
                            })
                    except Exception:
                        pass

                fn_response_part = types.Part.from_function_response(
                    name=tool_name,
                    response={"result": result},
                )
                contents.append(
                    types.Content(role="user", parts=[fn_response_part])
                )

        yield _sse({"type": "done"})
        return

    # ── Fallback: no Gemini key → try OpenRouter → OpenAI → rule-based ───
    async for chunk in _openai_compat_fallback(messages, _get_db, actor_id, actor_roles):
        yield chunk


# ── OpenAI-compatible agentic loop (shared by OpenRouter + OpenAI) ────────────

async def _run_openai_compat_loop(
    *,
    client: Any,
    model: str,
    messages: list[dict],
    get_db,  # callable: () -> Awaitable[(session, should_close)]
    actor_id: int,
    actor_roles: list[str],
) -> AsyncIterator[str]:
    """
    Generic agentic loop for any OpenAI-compatible API (OpenRouter, OpenAI, etc.).
    Yields SSE strings. Raises on API errors so the caller can try the next provider.
    """
    msgs = list(messages)  # local copy so retries don't corrupt the outer list

    for _round in range(6):
        stream = await client.chat.completions.create(
            model=model,
            messages=msgs,
            tools=TOOL_SCHEMAS,
            tool_choice="auto",
            stream=True,
            temperature=0.2,
        )

        accumulated_content = ""
        accumulated_tool_calls: list[dict] = []

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None:
                continue
            if delta.content:
                accumulated_content += delta.content
                yield _sse({"type": "token", "content": delta.content})
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

        if not accumulated_tool_calls:
            break

        assistant_msg: dict[str, Any] = {"role": "assistant", "content": accumulated_content or None}
        assistant_msg["tool_calls"] = [
            {
                "id": tc["id"],
                "type": "function",
                "function": {"name": tc["name"], "arguments": tc["args"]},
            }
            for tc in accumulated_tool_calls
        ]
        msgs.append(assistant_msg)

        for tc in accumulated_tool_calls:
            tool_name = tc["name"]
            try:
                args = json.loads(tc["args"] or "{}")
            except json.JSONDecodeError:
                args = {}

            yield _sse({"type": "tool_call", "name": tool_name, "args": args})

            try:
                tool_session, tool_should_close = await get_db()
                try:
                    result = await dispatch_tool(
                        name=tool_name,
                        args=args,
                        db=tool_session,
                        actor_id=actor_id,
                        actor_roles=actor_roles,
                        role_names=actor_roles,
                    )
                    if tool_should_close:
                        await tool_session.commit()
                finally:
                    if tool_should_close:
                        await tool_session.close()
            except Exception as exc:
                result = {"error": str(exc)}

            # ── ask_user tool: emit interactive SSE event and stop the loop ──
            if isinstance(result, dict) and result.get("__interactive__"):
                yield _sse({
                    "type": "interactive",
                    "component": result.get("component", "radio"),
                    "question": result.get("question", "Please select an option:"),
                    "options": result.get("options", []),
                    "context": result.get("context", "general"),
                })
                yield _sse({"type": "done"})
                return

            yield _sse({"type": "tool_result", "name": tool_name, "data": result})

            # ── Interactive widget injection ────────────────────────────────
            # When get_location_contents returns not-found, auto-fetch all
            # locations and emit an interactive checkbox widget for the user.
            if (
                tool_name == "get_location_contents"
                and isinstance(result, dict)
                and "error" in result
                and "not found" in str(result.get("error", "")).lower()
            ):
                searched = args.get("location_code", "that location")
                try:
                    loc_session, loc_close = await get_db()
                    try:
                        loc_list = await dispatch_tool(
                            name="list_locations",
                            args={"location_type": "rack"},
                            db=loc_session,
                            actor_id=actor_id,
                            actor_roles=actor_roles,
                            role_names=actor_roles,
                        )
                        if loc_close:
                            await loc_session.commit()
                    finally:
                        if loc_close:
                            await loc_session.close()

                    locs = loc_list.get("locations", [])
                    if locs:
                        options = [
                            {"value": l["code"], "label": f"{l['code']} — {l['name']}"}
                            for l in sorted(locs, key=lambda x: x.get("code", ""))[:20]
                        ]
                        yield _sse({
                            "type": "interactive",
                            "component": "checkbox",
                            "question": f"Location '{searched}' not found. Which location(s) did you mean?",
                            "options": options,
                            "context": "location_select",
                        })
                        # Inject location list for LLM context too
                        msgs.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": json.dumps({
                                **result,
                                "available_locations": [l["code"] for l in locs[:20]],
                                "hint": "An interactive selection widget has been shown to the user.",
                            }),
                        })
                        continue  # skip the normal msgs.append below
                except Exception:
                    pass  # silently fall through if location fetch fails

            msgs.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(result),
            })

    yield _sse({"type": "done"})


async def _openai_compat_fallback(
    messages: list[dict],
    get_db,
    actor_id: int,
    actor_roles: list[str],
) -> AsyncIterator[str]:
    """
    Try OpenRouter, then OpenAI, then rule-based — in that order.
    Each provider is attempted only if its API key is configured.
    """
    try:
        from openai import AsyncOpenAI  # noqa: F401 — ensure package installed
    except ImportError:
        yield _sse({"type": "error", "message": "openai package not installed. Run: pip install openai"})
        return

    providers = []
    if settings.OPENROUTER_API_KEY:
        providers.append(("OpenRouter/primary", _get_openrouter_client, settings.OPENROUTER_MODEL))
        if settings.OPENROUTER_SECONDARY_MODEL and settings.OPENROUTER_SECONDARY_MODEL != settings.OPENROUTER_MODEL:
            providers.append(("OpenRouter/qwen", _get_openrouter_client, settings.OPENROUTER_SECONDARY_MODEL))
    if settings.OPENAI_API_KEY:
        providers.append(("OpenAI", _get_openai_client, settings.OPENAI_MODEL))

    for provider_name, get_client, model in providers:
        log.info("Copilot: trying %s (%s)", provider_name, model)
        _started = False
        try:
            async for chunk in _run_openai_compat_loop(
                client=get_client(),
                model=model,
                messages=messages,
                get_db=get_db,
                actor_id=actor_id,
                actor_roles=actor_roles,
            ):
                _started = True
                yield chunk
        except Exception as exc:
            if _started:
                yield _sse({"type": "error", "message": "Connection to the AI service was interrupted. Please try again."})
                return
            log.warning("%s error (%s): trying next provider", provider_name, type(exc).__name__)
            continue
        return

    # All LLM providers exhausted — fall back to rule-based
    log.info("Copilot: all LLM providers failed/unconfigured, using rule-based fallback")
    session, should_close = await get_db()
    try:
        async for chunk in _fallback_responder(messages, session, actor_id, actor_roles):
            yield chunk
    finally:
        if should_close:
            await session.commit()
            await session.close()


# ── Rule-based fallback ───────────────────────────────────────────────────────

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
    text = (last_user or "").lower().strip()

    # ── Conversational / greeting intent ──────────────────────────────────────
    _greeting_starts = ("hello", "hi ", "hi,", "hey", "howdy", "greetings",
                        "good morning", "good afternoon", "good evening", "good night")
    _thanks_keywords = ("thank you", "thanks", "thank u", "appreciate", "great job", "well done", "nice work", "perfect")
    _help_keywords = ("what can you do", "what do you help", "what are you", "who are you",
                      "your capabilities", "how do you work", "what can i ask")

    _is_greeting = (
        any(text == g.strip() or text.startswith(g) for g in _greeting_starts)
        and len(text.split()) <= 8
    )
    _is_thanks = any(k in text for k in _thanks_keywords) and len(text.split()) <= 10
    _is_help = any(k in text for k in _help_keywords)

    if _is_greeting:
        response = (
            "Hello! I'm the SEAR Lab Inventory Copilot. Here's what I can help you with:\n\n"
            "- **Search items** — ask about any item by name or SKU\n"
            "- **Check stock levels** — quantities, low-stock alerts, reorder status\n"
            "- **Location queries** — what's in shelf A1, rack B, bin 3, etc.\n"
            "- **Transaction history** — recent stock in/out movements\n"
            "- **Dashboard summary** — overall inventory status\n"
            "- **Inventory operations** — stock in, stock out, transfers\n"
            "- **Lab documents** — search SOPs, manuals, calibration records, policies\n\n"
            "What would you like to do?"
        )
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})
        yield _sse({"type": "done"})
        return

    if _is_thanks:
        response = "You're welcome! Is there anything else you'd like to know about the inventory?"
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})
        yield _sse({"type": "done"})
        return

    if _is_help:
        response = (
            "I'm the SEAR Lab Inventory Copilot. I can help you with:\n\n"
            "- Searching for items by name, SKU, or category\n"
            "- Checking current stock levels and low-stock alerts\n"
            "- Viewing what's stored in specific locations (shelves, racks, bins)\n"
            "- Reviewing recent transaction history\n"
            "- Getting an inventory dashboard summary\n"
            "- Performing stock in, stock out, and transfer operations\n"
            "- Searching lab documents, SOPs, manuals, and policies\n\n"
            "Just ask naturally — for example: _'Show me all low-stock items'_ or _'What's in shelf A1?'_"
        )
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})
        yield _sse({"type": "done"})
        return

    # ── Check for purely conversational messages with no inventory keywords ───
    _inventory_signals = [
        "item", "stock", "shelf", "rack", "bin", "location", "sku", "quantity",
        "low", "reorder", "transaction", "history", "transfer", "dashboard",
        "summary", "overdue", "idle", "sop", "manual", "calibration", "invoice",
        "create", "update", "delete", "add", "remove", "find", "search", "show",
        "list", "how many", "where is", "what is", "check", "report",
    ]
    _word_count = len(text.split())
    _has_inventory_signal = any(sig in text for sig in _inventory_signals)

    if not _has_inventory_signal and _word_count <= 10:
        # Pure small talk — respond helpfully without searching inventory
        response = (
            "I'm the SEAR Lab Inventory Copilot and I'm best at answering inventory questions. "
            "You can ask me things like:\n\n"
            "- _\"Show me low-stock items\"_\n"
            "- _\"What's in shelf A1?\"_\n"
            "- _\"Show recent transactions\"_\n"
            "- _\"Give me the dashboard summary\"_\n\n"
            "How can I help you with the inventory today?"
        )
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})
        yield _sse({"type": "done"})
        return

    # Location intent: "shelf A1", "rack B", "bin 3", codes like "A1" / "A-01"
    location_intent = (
        any(k in text for k in ["shelf", "rack", "bin", "location", "cabinet", "drawer", "fridge", "freezer", "storage"])
        or bool(re.search(r'\b[a-z][0-9]+\b', text))         # e.g. a1, b2, c03
        or bool(re.search(r'\b[a-z]-\d+\b', text))           # e.g. a-01, b-03
    )

    # Dispatch based on keywords
    if location_intent:
        # Extract location code: try code-like pattern first, else use the full query
        match = re.search(r'\b([a-z][0-9]+|[a-z]-\d+)\b', text)
        location_query = match.group(1).upper() if match else " ".join(
            w for w in text.split() if w not in {"show", "what", "is", "in", "the", "at", "items", "stock", "from"}
        )
        yield _sse({"type": "tool_call", "name": "get_location_contents", "args": {"location_code": location_query}})
        result = await dispatch_tool("get_location_contents", {"location_code": location_query}, db, actor_id, actor_roles, actor_roles)
        yield _sse({"type": "tool_result", "name": "get_location_contents", "data": result})
        if "error" in result:
            # Try listing all locations as a fallback
            yield _sse({"type": "tool_call", "name": "list_locations", "args": {}})
            locs = await dispatch_tool("list_locations", {}, db, actor_id, actor_roles, actor_roles)
            yield _sse({"type": "tool_result", "name": "list_locations", "data": locs})
            loc_list = locs.get("locations", [])
            response = f"Location '{location_query}' not found. Available locations:\n\n"
            for loc in loc_list[:20]:
                response += f"- **{loc['code']}** — {loc['name']} ({loc['type']})\n"
        else:
            items = result.get("items", [])
            response = f"**{result['location_name']} ({result['location_code']})** — {result['item_count']} item(s):\n\n"
            for it in items:
                response += f"- **{it['name']}** ({it['sku']}): {it['quantity']} {it['unit']}\n"
            if not items:
                response += "_No items currently stocked here._\n"
        for chunk in _chunk_text(response):
            yield _sse({"type": "token", "content": chunk})

    elif any(k in text for k in ["low stock", "low-stock", "running out", "reorder", "shortage"]):
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
