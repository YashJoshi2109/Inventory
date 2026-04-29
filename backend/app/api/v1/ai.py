"""
AI endpoint module.

Provides:
  GET  /ai/search              — NLP inventory search
  GET  /ai/forecast/{item_id}  — Demand forecast for a consumable
  GET  /ai/anomalies           — Recent anomaly flags
  POST /ai/index/rebuild       — Trigger search index rebuild (admin)
  POST /ai/vision/analyze      — Gemini Vision image analysis
  POST /ai/metadata/suggest    — AI metadata suggestions for an item
"""
import asyncio
import base64
import json as json_lib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile

from app.ai.demand_forecaster import forecast as run_forecast
from app.ai.nlp_search import get_global_index, global_search, rebuild_global_index
from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.core.rate_limit import _chat_limiter, _get_client_ip, check_vision_quota, vision_quota_status as _vision_quota_status
from app.core.config import settings
from app.models.user import RoleName
from app.repositories.item_repo import ItemRepository
from app.repositories.transaction_repo import InventoryEventRepository, StockLevelRepository
from app.schemas.common import MessageResponse
from app.schemas.item import ItemSummary
from pydantic import BaseModel

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatRateLimitStatus(BaseModel):
    ip: str
    limit: int
    window_seconds: int
    used: int
    remaining: int
    retry_after_seconds: int
    provider: str
    model: str


class ForecastResponse(BaseModel):
    item_id: int
    item_sku: str
    item_name: str
    method: str
    avg_daily_consumption: float
    forecast_7d: float
    forecast_30d: float
    days_of_stock_remaining: float
    reorder_date: str | None
    confidence: float
    message: str


class SearchResponse(BaseModel):
    query: str
    hits: list[dict]
    total: int


class VisionQuotaStatus(BaseModel):
    primary_model: str
    fallback_models: list[str]
    last_model_used: str | None
    quota_limited: bool
    last_error: str | None
    checked_at: str | None
    last_success_at: str | None
    # Per-user quota (hourly window)
    user_scans_remaining: int
    user_scans_limit: int
    user_scans_remaining_day: int
    user_scans_limit_day: int
    user_retry_after_seconds: int


_vision_health: dict[str, str | bool | None] = {
    "last_model_used": None,
    "quota_limited": False,
    "last_error": None,
    "checked_at": None,
    "last_success_at": None,
}

# ── Cached vision clients (created once, reused across requests) ──────────────
# Creating a new AsyncOpenAI / genai.Client per request leaks httpx connection
# pools and gradually exhausts Render's 512 MB free-tier memory.
_vision_gemini_client = None  # genai.Client — reused across requests
_vision_or_client = None      # AsyncOpenAI for OpenRouter — reused across requests

# Semaphore: allow only 1 concurrent vision request on Render free tier.
# Two simultaneous PIL + Gemini calls can spike to ~400 MB+ and trigger OOM.
_vision_semaphore = asyncio.Semaphore(1)


def _get_vision_gemini_client():
    global _vision_gemini_client
    if _vision_gemini_client is None and settings.GEMINI_API_KEY:
        from google import genai
        _vision_gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _vision_gemini_client


def _get_vision_or_client():
    global _vision_or_client
    if _vision_or_client is None and settings.OPENROUTER_API_KEY:
        from openai import AsyncOpenAI
        _vision_or_client = AsyncOpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://sear-lab-inventory.app",
                "X-Title": "SEAR Lab Smart Scan",
            },
        )
    return _vision_or_client


@router.get("/rate-limit", response_model=ChatRateLimitStatus)
async def chat_rate_limit(
    request: Request,
    current_user: CurrentUser,
) -> ChatRateLimitStatus:
    """
    Returns the current in-memory sliding-window rate-limit status for chat messages
    for the caller's IP.
    """
    ip = _get_client_ip(request)
    status = _chat_limiter.status(ip)
    return ChatRateLimitStatus(
        ip=ip,
        **status,
        provider="gemini",
        model=settings.GEMINI_CHAT_MODEL,
    )


@router.get("/vision/status", response_model=VisionQuotaStatus)
async def get_vision_quota_status(
    current_user: CurrentUser,
) -> VisionQuotaStatus:
    uq = _vision_quota_status(current_user.id)
    return VisionQuotaStatus(
        primary_model=settings.GEMINI_VISION_MODEL,
        fallback_models=settings.GEMINI_VISION_FALLBACK_MODELS,
        last_model_used=_vision_health.get("last_model_used"),  # type: ignore[arg-type]
        quota_limited=bool(_vision_health.get("quota_limited", False)),
        last_error=_vision_health.get("last_error"),  # type: ignore[arg-type]
        checked_at=_vision_health.get("checked_at"),  # type: ignore[arg-type]
        last_success_at=_vision_health.get("last_success_at"),  # type: ignore[arg-type]
        user_scans_remaining=uq["scans_remaining_hour"],
        user_scans_limit=uq["scans_limit_hour"],
        user_scans_remaining_day=uq["scans_remaining_day"],
        user_scans_limit_day=uq["scans_limit_day"],
        user_retry_after_seconds=uq["retry_after_seconds"],
    )


@router.get("/search", response_model=SearchResponse)
async def nlp_search(
    q: str = Query(min_length=2, description="Natural language search query"),
    session: DbSession = None,
    current_user: CurrentUser = None,
    limit: int = Query(default=10, ge=1, le=50),
) -> SearchResponse:
    hits = global_search(q, top_k=limit)
    if not hits:
        return SearchResponse(query=q, hits=[], total=0)

    # Enrich with DB data — batch fetch items + stock totals to avoid N+1
    item_repo = ItemRepository(session)
    stock_repo = StockLevelRepository(session)

    hit_item_ids = [hit.item_id for hit in hits]
    stock_totals = await stock_repo.get_totals_for_items(hit_item_ids)

    enriched = []
    for hit in hits:
        item = await item_repo.get_with_details(hit.item_id)
        if item:
            from decimal import Decimal
            total_qty = stock_totals.get(item.id, Decimal("0"))
            enriched.append({
                "id": item.id,
                "sku": item.sku,
                "name": item.name,
                "category": item.category.name if item.category else None,
                "total_quantity": float(total_qty),
                "unit": item.unit,
                "score": hit.score,
            })

    return SearchResponse(query=q, hits=enriched, total=len(enriched))


@router.get("/forecast/{item_id}", response_model=ForecastResponse)
async def demand_forecast(
    item_id: int,
    session: DbSession,
    current_user: CurrentUser,
    days: int = Query(default=90, ge=14, le=365),
) -> ForecastResponse:
    item_repo = ItemRepository(session)
    event_repo = InventoryEventRepository(session)
    stock_repo = StockLevelRepository(session)

    item = await item_repo.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    daily_data = await event_repo.get_consumption_time_series(item_id, days=days)
    current_stock = float(await stock_repo.get_total_for_item(item_id))
    result = run_forecast(daily_data, current_stock, float(item.reorder_level))

    return ForecastResponse(
        item_id=item.id,
        item_sku=item.sku,
        item_name=item.name,
        method=result.method,
        avg_daily_consumption=result.avg_daily_consumption,
        forecast_7d=result.forecast_7d,
        forecast_30d=result.forecast_30d,
        days_of_stock_remaining=result.days_of_stock_remaining,
        reorder_date=result.reorder_date.isoformat() if result.reorder_date else None,
        confidence=result.confidence,
        message=result.message,
    )


@router.post(
    "/index/rebuild",
    response_model=MessageResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
async def rebuild_search_index(session: DbSession, current_user: CurrentUser) -> MessageResponse:
    from sqlalchemy import select
    from app.models.item import Item

    result = await session.execute(
        select(Item).where(Item.is_active == True)  # noqa: E712
    )
    items = result.scalars().all()
    item_dicts = [
        {
            "id": item.id,
            "sku": item.sku,
            "name": item.name,
            "description": item.description or "",
            "supplier": item.supplier or "",
            "cas_number": item.cas_number or "",
            "part_number": item.part_number or "",
        }
        for item in items
    ]
    rebuild_global_index(item_dicts)
    return MessageResponse(message=f"Search index rebuilt: {len(item_dicts)} items indexed")


# ─── Vision Analysis ──────────────────────────────────────────────────────────

class VisionAnalysisResult(BaseModel):
    detected_items: list[dict]       # [{name, category, brand, model, quantity, confidence, notes}]
    ocr_text: str                    # Raw OCR text extracted from the image
    item_count: int                  # Total distinct items detected
    damage_detected: bool
    damage_notes: str
    metadata_suggestions: dict       # {category, tags, brand, model, usage_type}
    shelf_audit: dict                # {total_visible, organized, issues}
    raw_analysis: str                # Full Gemini response text
    analysis_type: str


_VISION_PROMPTS: dict[str, str] = {
    "classify": (
        "You are an inventory classification assistant for a university research lab. "
        "Examine this image and identify every distinct item visible. "
        "For each item provide: name, category (chemical/electronic/equipment/tool/safety/consumable/other), "
        "brand (if readable), model (if readable), estimated quantity, confidence (0.0–1.0), and any notes. "
        "Also extract any text visible in the image (serial numbers, labels, barcodes) as ocr_text. "
        "Return ONLY valid JSON matching this schema exactly:\n"
        '{"detected_items":[{"name":"","category":"","brand":"","model":"","quantity":1,"confidence":0.9,"notes":""}],'
        '"ocr_text":"","item_count":0,"damage_detected":false,"damage_notes":"",'
        '"metadata_suggestions":{"category":"","tags":[],"brand":"","model":"","usage_type":""},'
        '"shelf_audit":{"total_visible":0,"organized":true,"issues":[]}}'
    ),
    "ocr": (
        "You are an OCR assistant for a lab inventory system. "
        "Extract ALL text visible in this image: labels, serial numbers, barcodes, model numbers, "
        "chemical names, CAS numbers, part numbers, manufacturer text, expiry dates, and any other text. "
        "Also identify any items you can see from the text. "
        "Return ONLY valid JSON matching this schema exactly:\n"
        '{"detected_items":[{"name":"","category":"","brand":"","model":"","quantity":1,"confidence":0.9,"notes":""}],'
        '"ocr_text":"","item_count":0,"damage_detected":false,"damage_notes":"",'
        '"metadata_suggestions":{"category":"","tags":[],"brand":"","model":"","usage_type":""},'
        '"shelf_audit":{"total_visible":0,"organized":true,"issues":[]}}'
    ),
    "count": (
        "You are an inventory counting assistant for a university research lab. "
        "Count every distinct item visible in this image as accurately as possible. "
        "Group identical items together and provide a count for each group. "
        "Return ONLY valid JSON matching this schema exactly:\n"
        '{"detected_items":[{"name":"","category":"","brand":"","model":"","quantity":1,"confidence":0.9,"notes":""}],'
        '"ocr_text":"","item_count":0,"damage_detected":false,"damage_notes":"",'
        '"metadata_suggestions":{"category":"","tags":[],"brand":"","model":"","usage_type":""},'
        '"shelf_audit":{"total_visible":0,"organized":true,"issues":[]}}'
    ),
    "damage": (
        "You are a damage assessment assistant for lab equipment and supplies. "
        "Carefully inspect this image for any signs of damage, wear, corrosion, leaks, cracks, "
        "contamination, improper storage, or safety hazards. "
        "Also identify the items shown and extract any visible text. "
        "Return ONLY valid JSON matching this schema exactly:\n"
        '{"detected_items":[{"name":"","category":"","brand":"","model":"","quantity":1,"confidence":0.9,"notes":""}],'
        '"ocr_text":"","item_count":0,"damage_detected":false,"damage_notes":"",'
        '"metadata_suggestions":{"category":"","tags":[],"brand":"","model":"","usage_type":""},'
        '"shelf_audit":{"total_visible":0,"organized":true,"issues":[]}}'
    ),
    "audit": (
        "You are a shelf and storage audit assistant for a university research lab. "
        "Analyze this image of a shelf, rack, or storage area. Assess: "
        "1) How many items are visible and what they are. "
        "2) Whether items are organized and properly stored. "
        "3) Any storage issues (overcrowding, improper placement, safety concerns, missing labels). "
        "4) Any visible damage or hazards. "
        "Return ONLY valid JSON matching this schema exactly:\n"
        '{"detected_items":[{"name":"","category":"","brand":"","model":"","quantity":1,"confidence":0.9,"notes":""}],'
        '"ocr_text":"","item_count":0,"damage_detected":false,"damage_notes":"",'
        '"metadata_suggestions":{"category":"","tags":[],"brand":"","model":"","usage_type":""},'
        '"shelf_audit":{"total_visible":0,"organized":true,"issues":[]}}'
    ),
    "full": (
        "You are a comprehensive inventory analysis assistant for a university research lab (UTA SEAR Lab). "
        "Perform a FULL analysis of this image:\n"
        "1. DETECT & CLASSIFY every distinct item visible (name, category, brand, model, quantity, confidence 0–1, notes)\n"
        "2. OCR: extract all visible text (serial numbers, labels, CAS numbers, barcodes, model numbers, expiry dates)\n"
        "3. COUNT total distinct items\n"
        "4. DAMAGE: check for any damage, wear, leaks, cracks, corrosion, or safety hazards\n"
        "5. METADATA: suggest best category, relevant tags, brand, model, and usage_type for the primary item\n"
        "   usage_type must be one of: consumable, equipment, chemical, electronic, tool, safety\n"
        "6. SHELF AUDIT: assess organization, count total visible, list any storage issues\n\n"
        "Return ONLY valid JSON with NO markdown, NO code fences, matching this schema exactly:\n"
        '{"detected_items":[{"name":"","category":"","brand":"","model":"","quantity":1,"confidence":0.9,"notes":""}],'
        '"ocr_text":"","item_count":0,"damage_detected":false,"damage_notes":"",'
        '"metadata_suggestions":{"category":"","tags":[],"brand":"","model":"","usage_type":""},'
        '"shelf_audit":{"total_visible":0,"organized":true,"issues":[]}}'
    ),
}


@router.post("/vision/analyze", response_model=VisionAnalysisResult)
async def analyze_vision(
    current_user: CurrentUser,
    image: UploadFile = File(...),
    analysis_type: str = Form(default="full"),
    context: str = Form(default=""),
) -> VisionAnalysisResult:
    """
    Analyze an uploaded image using Gemini Vision for inventory management.

    analysis_type options: full, classify, ocr, count, damage, audit
    context: optional free-text context to include in the prompt
    """
    if not settings.GEMINI_API_KEY and not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="No vision AI provider configured (set GEMINI_API_KEY or OPENROUTER_API_KEY)")

    # ── Per-user rate limit (15 scans/hour, 50 scans/day) ─────────────────────
    allowed, retry_after, remaining, limit = check_vision_quota(current_user.id)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "VISION_USER_QUOTA",
                "message": f"Scan limit reached ({limit}/hr). Try again in {retry_after}s.",
                "retry_after_seconds": retry_after,
                "scans_remaining": 0,
                "scans_limit": limit,
            },
            headers={"Retry-After": str(retry_after)},
        )

    # ── Concurrency guard — only 1 vision request at a time on Render free tier ─
    # Two concurrent PIL + model calls can spike to ~400 MB+ and trigger OOM kill.
    if _vision_semaphore.locked():
        raise HTTPException(
            status_code=503,
            detail="Vision analysis busy — another scan is in progress. Please retry in a few seconds.",
        )

    async with _vision_semaphore:
        return await _run_vision_analysis(current_user, image, analysis_type, context)


async def _run_vision_analysis(
    current_user,
    image: UploadFile,
    analysis_type: str,
    context: str,
) -> VisionAnalysisResult:
    """Inner implementation — called while holding the vision semaphore."""
    import gc
    from io import BytesIO

    client = _get_vision_gemini_client()

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")

    # Reject images > 10 MB before doing any work
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Image too large (max 10 MB). Please reduce the image size before uploading.",
        )

    # Aggressively resize + compress image to keep peak memory well below 512 MB limit.
    # Target: ≤640px longest side, JPEG quality 65 → ~40-60 KB output.
    mime_type = image.content_type or "image/jpeg"
    try:
        from PIL import Image as _PilImage

        buf_in = BytesIO(image_bytes)
        del image_bytes
        image_bytes = b""

        with _PilImage.open(buf_in) as img:
            img = img.convert("RGB")
            max_dim = 640
            if img.width > max_dim or img.height > max_dim:
                img.thumbnail((max_dim, max_dim), _PilImage.LANCZOS)
            buf_out = BytesIO()
            img.save(buf_out, format="JPEG", quality=65, optimize=True)
            image_bytes = buf_out.getvalue()
        del buf_in, buf_out
        gc.collect()
        mime_type = "image/jpeg"
    except Exception:
        pass

    prompt_key = analysis_type if analysis_type in _VISION_PROMPTS else "full"
    prompt_text = _VISION_PROMPTS[prompt_key]
    if context.strip():
        prompt_text = f"Additional context: {context.strip()}\n\n{prompt_text}"

    response = None
    quota_errors: list[str] = []
    last_exc: Exception | None = None

    # ── Try Gemini models first ────────────────────────────────────────────────
    if client is not None:
        from google.genai import types as genai_types

        model_candidates = [settings.GEMINI_VISION_MODEL, *settings.GEMINI_VISION_FALLBACK_MODELS]
        seen: set[str] = set()
        ordered_models: list[str] = []
        for m in model_candidates:
            if not m or m in seen:
                continue
            seen.add(m)
            ordered_models.append(m)

        for model_name in ordered_models:
            try:
                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=[
                        genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        prompt_text,
                    ],
                )
                del image_bytes
                now = datetime.now(timezone.utc).isoformat()
                _vision_health["last_model_used"] = model_name
                _vision_health["quota_limited"] = False
                _vision_health["last_error"] = None
                _vision_health["checked_at"] = now
                _vision_health["last_success_at"] = now
                break
            except Exception as exc:
                last_exc = exc
                msg = str(exc)
                _vision_health["last_model_used"] = model_name
                _vision_health["checked_at"] = datetime.now(timezone.utc).isoformat()
                if "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower() or "429" in msg:
                    quota_errors.append(f"{model_name}: quota/rate limited")
                    _vision_health["quota_limited"] = True
                    _vision_health["last_error"] = "quota/rate limited"
                    continue
                if "NOT_FOUND" in msg or "404" in msg or "not found" in msg.lower() or "not supported" in msg.lower():
                    quota_errors.append(f"{model_name}: model not available")
                    _vision_health["last_error"] = "model not available"
                    continue
                _vision_health["quota_limited"] = False
                _vision_health["last_error"] = str(exc)
                raise HTTPException(status_code=502, detail=f"Gemini Vision API error ({model_name}): {exc}") from exc

    # ── Fallback: OpenRouter vision models (tried in sequence) ────────────────
    if response is None and settings.OPENROUTER_API_KEY:
        import base64 as _b64
        _or_client = _get_vision_or_client()
        b64_image = _b64.b64encode(image_bytes).decode()
        del image_bytes  # free — b64 string is the only copy needed now

        _or_vision_models: list[str] = []
        _seen_or: set[str] = set()
        for _m in [settings.OPENROUTER_VISION_MODEL, *settings.OPENROUTER_VISION_FALLBACK_MODELS]:
            if _m and _m not in _seen_or:
                _seen_or.add(_m)
                _or_vision_models.append(_m)

        for _or_model in _or_vision_models:
            try:
                or_resp = await _or_client.chat.completions.create(
                    model=_or_model,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt_text},
                            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_image}"}},
                        ],
                    }],
                    temperature=0.1,
                    max_tokens=800,
                )
                del b64_image  # free b64 string after sending
                class _FakeResponse:  # noqa: N801
                    text = or_resp.choices[0].message.content or ""
                response = _FakeResponse()
                del or_resp
                now = datetime.now(timezone.utc).isoformat()
                _vision_health["last_model_used"] = _or_model
                _vision_health["quota_limited"] = False
                _vision_health["last_error"] = None
                _vision_health["checked_at"] = now
                _vision_health["last_success_at"] = now
                break
            except Exception as or_exc:
                last_exc = or_exc
                _vision_health["last_model_used"] = _or_model
                _vision_health["last_error"] = str(or_exc)
                _vision_health["checked_at"] = datetime.now(timezone.utc).isoformat()
                quota_errors.append(f"OpenRouter/{_or_model}: {or_exc}")

    if response is None:
        if quota_errors:
            tried = ", ".join(quota_errors)
            _vision_health["last_error"] = f"quota exceeded: {tried}"
            raise HTTPException(
                status_code=429,
                detail=(
                    "Vision quota exceeded across all providers (Gemini + OpenRouter). "
                    "Please check your API quotas or wait and retry."
                ),
            ) from last_exc
        raise HTTPException(status_code=502, detail=f"Vision API error: {last_exc or 'no response from any provider'}")

    raw_text = response.text or ""
    del response  # free model response object immediately
    gc.collect()

    # Strip markdown code fences if present
    clean_text = raw_text.strip()
    if clean_text.startswith("```"):
        lines = clean_text.splitlines()
        clean_text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        data = json_lib.loads(clean_text)
        return VisionAnalysisResult(
            detected_items=data.get("detected_items", []),
            ocr_text=data.get("ocr_text", ""),
            item_count=data.get("item_count", len(data.get("detected_items", []))),
            damage_detected=bool(data.get("damage_detected", False)),
            damage_notes=data.get("damage_notes", ""),
            metadata_suggestions=data.get("metadata_suggestions", {}),
            shelf_audit=data.get("shelf_audit", {"total_visible": 0, "organized": True, "issues": []}),
            raw_analysis=raw_text,
            analysis_type=analysis_type,
        )
    except (json_lib.JSONDecodeError, KeyError, TypeError):
        return VisionAnalysisResult(
            detected_items=[],
            ocr_text="",
            item_count=0,
            damage_detected=False,
            damage_notes="",
            metadata_suggestions={},
            shelf_audit={"total_visible": 0, "organized": True, "issues": []},
            raw_analysis=raw_text,
            analysis_type=analysis_type,
        )


# ─── Metadata Suggestion ──────────────────────────────────────────────────────

class MetadataSuggestion(BaseModel):
    category: str
    tags: list[str]
    brand: str
    model: str
    usage_type: str   # consumable, equipment, chemical, electronic, tool, safety
    description: str
    unit: str          # pcs, ml, g, kg, L, etc.


@router.post("/metadata/suggest", response_model=MetadataSuggestion)
async def suggest_metadata(
    current_user: CurrentUser,
    name: str = Form(...),
    description: str = Form(default=""),
) -> MetadataSuggestion:
    """
    Given an item name and optional description, use Gemini to suggest
    inventory metadata (category, tags, brand, model, usage_type, unit).
    """
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Gemini API key not configured")

    from app.ai.copilot import _get_gemini_client
    client = _get_gemini_client()

    prompt = (
        "You are an inventory metadata assistant for a university research lab (UTA SEAR Lab). "
        f"Item name: {name}\n"
        + (f"Description: {description}\n" if description.strip() else "")
        + "\nSuggest the best metadata for this item in a lab inventory system. "
        "usage_type must be one of: consumable, equipment, chemical, electronic, tool, safety. "
        "unit should be the most appropriate unit (pcs, ml, g, kg, L, box, roll, pair, set, etc.). "
        "Return ONLY valid JSON with NO markdown matching this schema:\n"
        '{"category":"","tags":[],"brand":"","model":"","usage_type":"","description":"","unit":""}'
    )

    try:
        response = await client.aio.models.generate_content(
            model=settings.GEMINI_CHAT_MODEL,
            contents=[prompt],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini API error: {exc}") from exc

    raw_text = response.text or ""
    clean_text = raw_text.strip()
    if clean_text.startswith("```"):
        lines = clean_text.splitlines()
        clean_text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        data = json_lib.loads(clean_text)
        return MetadataSuggestion(
            category=data.get("category", ""),
            tags=data.get("tags", []),
            brand=data.get("brand", ""),
            model=data.get("model", ""),
            usage_type=data.get("usage_type", "equipment"),
            description=data.get("description", ""),
            unit=data.get("unit", "pcs"),
        )
    except (json_lib.JSONDecodeError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to parse Gemini metadata response: {exc}",
        ) from exc
