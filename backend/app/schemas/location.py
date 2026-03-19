from datetime import datetime

from pydantic import Field

from app.schemas.common import OrmBase


class AreaCreate(OrmBase):
    code: str = Field(min_length=2, max_length=30, pattern=r"^[A-Za-z0-9\-_]+$")
    name: str = Field(min_length=1, max_length=150)
    description: str | None = None
    building: str | None = None
    floor: str | None = None
    room: str | None = None


class AreaUpdate(OrmBase):
    name: str | None = None
    description: str | None = None
    building: str | None = None
    floor: str | None = None
    room: str | None = None
    is_active: bool | None = None


class AreaRead(OrmBase):
    id: int
    code: str
    name: str
    description: str | None = None
    building: str | None = None
    floor: str | None = None
    room: str | None = None
    is_active: bool
    created_at: datetime
    location_count: int = 0


class LocationCreate(OrmBase):
    area_id: int
    code: str = Field(min_length=2, max_length=50, pattern=r"^[A-Za-z0-9\-_]+$")
    name: str = Field(min_length=1, max_length=150)
    description: str | None = None
    shelf: str | None = None
    bin_label: str | None = None
    capacity: int | None = None


class LocationUpdate(OrmBase):
    name: str | None = None
    description: str | None = None
    shelf: str | None = None
    bin_label: str | None = None
    capacity: int | None = None
    is_active: bool | None = None


class LocationBarcodeRead(OrmBase):
    id: int
    barcode_value: str
    barcode_type: str
    label_printed: bool


class LocationRead(OrmBase):
    id: int
    area_id: int
    area_code: str
    area_name: str
    code: str
    name: str
    description: str | None = None
    shelf: str | None = None
    bin_label: str | None = None
    capacity: int | None = None
    is_active: bool
    created_at: datetime
    barcodes: list[LocationBarcodeRead] = []
    item_count: int = 0
