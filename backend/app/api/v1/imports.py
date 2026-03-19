from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status

from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.models.user import RoleName
from app.models.transaction import ImportJob
from app.services.import_service import ImportService
from app.schemas.common import OrmBase

router = APIRouter(prefix="/imports", tags=["imports"])


class ImportJobRead(OrmBase):
    id: int
    filename: str
    status: str
    total_rows: int
    imported_rows: int
    skipped_rows: int
    error_rows: int
    errors: str | None = None


@router.post(
    "/excel",
    response_model=ImportJobRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def import_excel(
    session: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> ImportJobRead:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx and .xls files are supported")

    content = await file.read()
    svc = ImportService(session)
    job = await svc.import_excel(content, file.filename, current_user.id)
    return ImportJobRead.model_validate(job)


@router.post(
    "/csv",
    response_model=ImportJobRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def import_csv(
    session: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> ImportJobRead:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await file.read()
    import io
    import pandas as pd

    try:
        df = pd.read_csv(io.BytesIO(content))
        # Normalise CSV to xlsx-like bytes and delegate to Excel importer
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Items_Master", index=False)
        svc = ImportService(session)
        job = await svc.import_excel(buf.getvalue(), file.filename, current_user.id)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"CSV parse error: {e}") from e

    return ImportJobRead.model_validate(job)


@router.get("/jobs", response_model=list[ImportJobRead])
async def list_import_jobs(
    session: DbSession,
    current_user: CurrentUser,
    limit: int = 20,
) -> list[ImportJobRead]:
    from sqlalchemy import select
    result = await session.execute(
        select(ImportJob).order_by(ImportJob.created_at.desc()).limit(limit)
    )
    jobs = result.scalars().all()
    return [ImportJobRead.model_validate(j) for j in jobs]
