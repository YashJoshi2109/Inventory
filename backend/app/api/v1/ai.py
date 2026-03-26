"""
AI endpoint module.

Provides:
  GET  /ai/search              — NLP inventory search
  GET  /ai/forecast/{item_id}  — Demand forecast for a consumable
  GET  /ai/anomalies           — Recent anomaly flags
  POST /ai/index/rebuild       — Trigger search index rebuild (admin)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.ai.demand_forecaster import forecast as run_forecast
from app.ai.nlp_search import get_global_index, global_search, rebuild_global_index
from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.core.rate_limit import _chat_limiter, _get_client_ip
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

    # Enrich with DB data
    item_repo = ItemRepository(session)
    stock_repo = StockLevelRepository(session)
    enriched = []
    for hit in hits:
        item = await item_repo.get_with_details(hit.item_id)
        if item:
            total_qty = await stock_repo.get_total_for_item(item.id)
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
