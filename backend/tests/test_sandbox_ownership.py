import inspect
from app.repositories.item_repo import ItemRepository, CategoryRepository
from app.repositories.transaction_repo import InventoryEventRepository, AlertRepository

def test_get_low_stock_items_accepts_owner_id():
    sig = inspect.signature(ItemRepository.get_low_stock_items)
    assert "owner_id" in sig.parameters

def test_item_repo_count_accepts_owner_id():
    sig = inspect.signature(ItemRepository.count)
    assert "owner_id" in sig.parameters

def test_get_all_with_counts_accepts_owner_id():
    sig = inspect.signature(CategoryRepository.get_all_with_counts)
    assert "owner_id" in sig.parameters

def test_get_events_paginated_accepts_actor_id():
    sig = inspect.signature(InventoryEventRepository.get_events_paginated)
    assert "actor_id" in sig.parameters

def test_count_active_accepts_owner_id():
    sig = inspect.signature(AlertRepository.count_active)
    assert "owner_id" in sig.parameters

def test_get_transactions_count_since_accepts_actor_id():
    sig = inspect.signature(InventoryEventRepository.get_transactions_count_since)
    assert "actor_id" in sig.parameters
