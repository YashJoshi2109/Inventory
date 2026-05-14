from fastapi import APIRouter

from app.api.v1 import auth, items, locations, barcodes, scans, transactions, dashboard, imports, ai, users, chat, passkeys, energy, energy_influx, rfid

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(passkeys.router)
api_router.include_router(items.router)
api_router.include_router(locations.router)
api_router.include_router(barcodes.router)
api_router.include_router(scans.router)
api_router.include_router(transactions.router)
api_router.include_router(dashboard.router)
api_router.include_router(imports.router)
api_router.include_router(ai.router)
api_router.include_router(users.router)
api_router.include_router(chat.router)
api_router.include_router(energy.router)
api_router.include_router(energy_influx.router)
api_router.include_router(rfid.router)
