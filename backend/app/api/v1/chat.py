"""
AI Copilot Chat API.

POST /chat/sessions                    — create a new chat session
GET  /chat/sessions                    — list user's sessions
DELETE /chat/sessions/{id}             — delete session + messages
GET  /chat/sessions/{id}/messages      — full message history
POST /chat/sessions/{id}/messages      — send message (SSE streaming response)
POST /chat/documents                   — upload knowledge-base document
GET  /chat/documents                   — list uploaded documents
DELETE /chat/documents/{id}            — remove document
PATCH /chat/sessions/{id}/title        — rename session
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.ai.copilot import SYSTEM_PROMPT, run_copilot
from app.api.v1.auth import CurrentUser, require_roles
from app.core.config import settings
from app.core.database import DbSession
from app.models.chat import (
    ChatMessage,
    ChatSession,
    DocChunk,
    DocStatus,
    KnowledgeDocument,
    MessageRole,
)
from app.models.user import RoleName

router = APIRouter(prefix="/chat", tags=["chat"])

UPLOAD_BASE = Path(settings.UPLOAD_DIR) / "knowledge"
UPLOAD_BASE.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/csv",
}


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class SessionOut(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: int
    role: str
    content: str | None
    tool_name: str | None
    tool_result: str | None
    sources: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentOut(BaseModel):
    id: int
    title: str
    filename: str
    doc_type: str
    status: str
    chunk_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateSessionRequest(BaseModel):
    title: str = "New chat"


class RenameTitleRequest(BaseModel):
    title: str


# ── Session endpoints ──────────────────────────────────────────────────────────

@router.post("/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CreateSessionRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> SessionOut:
    session = ChatSession(user_id=current_user.id, title=body.title)
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return SessionOut(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        updated_at=session.updated_at,
        message_count=0,
    )


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(default=50, le=200),
) -> list[SessionOut]:
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc())
        .limit(limit)
    )
    sessions = result.scalars().all()
    out = []
    for s in sessions:
        msg_result = await db.execute(
            select(ChatMessage).where(ChatMessage.session_id == s.id)
        )
        count = len(msg_result.scalars().all())
        out.append(
            SessionOut(
                id=s.id,
                title=s.title,
                created_at=s.created_at,
                updated_at=s.updated_at,
                message_count=count,
            )
        )
    return out


@router.patch("/sessions/{session_id}/title", response_model=SessionOut)
async def rename_session(
    session_id: int,
    body: RenameTitleRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> SessionOut:
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.title = body.title[:255]
    await db.flush()
    await db.refresh(session)
    return SessionOut(
        id=session.id,
        title=session.title,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
async def get_messages(
    session_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> list[MessageOut]:
    sess_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
    )
    if not sess_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: int,
    db: DbSession,
    current_user: CurrentUser,
    content: str = Query(min_length=1, max_length=4000),
) -> StreamingResponse:
    """Send a message and stream back an SSE response from the AI copilot."""
    sess_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Persist user message
    user_msg = ChatMessage(
        session_id=session.id,
        role=MessageRole.USER,
        content=content,
    )
    db.add(user_msg)
    await db.flush()

    # Build message history for the LLM
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    history = history_result.scalars().all()

    openai_messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history:
        if msg.role == MessageRole.USER:
            openai_messages.append({"role": "user", "content": msg.content or ""})
        elif msg.role == MessageRole.ASSISTANT:
            openai_messages.append({"role": "assistant", "content": msg.content or ""})

    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]

    # Update session title from first user message
    if session.title == "New chat" and len(history) == 1:
        session.title = content[:80]
        await db.flush()

    async def event_stream() -> AsyncIterator[bytes]:
        assistant_content = ""
        tool_events: list[dict] = []

        async for sse_line in run_copilot(
            messages=openai_messages,
            db=db,
            actor_id=current_user.id,
            actor_roles=actor_roles,
        ):
            yield sse_line.encode()

            # Track accumulated content for persistence
            try:
                payload = json.loads(sse_line.replace("data: ", "").strip())
                if payload.get("type") == "token":
                    assistant_content += payload.get("content", "")
                elif payload.get("type") in ("tool_call", "tool_result"):
                    tool_events.append(payload)
                elif payload.get("type") == "done":
                    # Persist assistant message
                    asst_msg = ChatMessage(
                        session_id=session_id,
                        role=MessageRole.ASSISTANT,
                        content=assistant_content or None,
                    )
                    db.add(asst_msg)
                    await db.flush()
            except Exception:
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Document endpoints ─────────────────────────────────────────────────────────

@router.post(
    "/documents",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    doc_type: str = Form(default="general"),
    title: str = Form(default=""),
) -> DocumentOut:
    """Upload a knowledge-base document (PDF, DOCX, TXT, MD, CSV)."""
    if file.content_type not in ALLOWED_MIME and not (file.filename or "").endswith(
        (".pdf", ".docx", ".doc", ".txt", ".md", ".csv")
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: PDF, DOCX, TXT, MD, CSV",
        )

    safe_name = f"{uuid.uuid4().hex}_{(file.filename or 'upload').replace(' ', '_')}"
    dest = UPLOAD_BASE / safe_name
    content = await file.read()
    dest.write_bytes(content)

    doc = KnowledgeDocument(
        title=title or (file.filename or "Untitled"),
        filename=file.filename or safe_name,
        mime_type=file.content_type or "application/octet-stream",
        doc_type=doc_type,
        file_path=str(dest),
        uploaded_by=current_user.id,
        status=DocStatus.PENDING,
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    # Background: extract text and chunk (simple implementation)
    try:
        chunks = _extract_text_chunks(dest, file.content_type or "")
        for i, chunk_text in enumerate(chunks):
            db.add(DocChunk(
                doc_id=doc.id,
                chunk_index=i,
                content=chunk_text,
                token_count=len(chunk_text.split()),
            ))
        doc.chunk_count = len(chunks)
        doc.status = DocStatus.READY
        await db.flush()
    except Exception:
        doc.status = DocStatus.FAILED
        await db.flush()

    await db.refresh(doc)
    return doc


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(
    db: DbSession,
    current_user: CurrentUser,
) -> list[DocumentOut]:
    result = await db.execute(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.is_active == True)  # noqa: E712
        .order_by(KnowledgeDocument.created_at.desc())
    )
    return result.scalars().all()


@router.delete("/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    result = await db.execute(
        select(KnowledgeDocument).where(KnowledgeDocument.id == doc_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.is_active = False
    await db.flush()


# ── Text extraction helpers ───────────────────────────────────────────────────

def _extract_text_chunks(path: Path, mime_type: str, chunk_size: int = 600) -> list[str]:
    """Extract plain text from a file and split into overlapping chunks."""
    text = ""
    suffix = path.suffix.lower()

    if suffix == ".pdf" or "pdf" in mime_type:
        text = _read_pdf(path)
    elif suffix in (".docx",) or "wordprocessingml" in mime_type:
        text = _read_docx(path)
    else:
        text = path.read_text(encoding="utf-8", errors="replace")

    # Split by paragraphs then chunk
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if len(current.split()) + len(para.split()) < chunk_size:
            current = (current + "\n\n" + para).strip()
        else:
            if current:
                chunks.append(current)
            current = para
    if current:
        chunks.append(current)
    return chunks or [text[:4000]]


def _read_pdf(path: Path) -> str:
    try:
        import pypdf
        reader = pypdf.PdfReader(str(path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except ImportError:
        return f"[PDF: {path.name} — install pypdf to extract text]"
    except Exception as exc:
        return f"[PDF extraction error: {exc}]"


def _read_docx(path: Path) -> str:
    try:
        import docx
        doc = docx.Document(str(path))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except ImportError:
        return f"[DOCX: {path.name} — install python-docx to extract text]"
    except Exception as exc:
        return f"[DOCX extraction error: {exc}]"
