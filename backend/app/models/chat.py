"""
Chat / AI Copilot persistence models.

Tables:
  chat_sessions      — one conversation thread per user
  chat_messages      — immutable message log per session
  knowledge_docs     — uploaded knowledge-base documents (SOPs, manuals, …)
  doc_chunks         — text chunks with optional OpenAI embedding vector
"""
from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class DocStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="New chat")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[list[ChatMessage]] = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )
    user: Mapped["User"] = relationship("User")  # type: ignore[name-defined]  # noqa: F821


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)        # user | assistant | tool
    content: Mapped[str | None] = mapped_column(Text)                   # text content
    tool_name: Mapped[str | None] = mapped_column(String(100))          # for role=tool
    tool_args: Mapped[str | None] = mapped_column(Text)                 # JSON
    tool_result: Mapped[str | None] = mapped_column(Text)               # JSON result
    sources: Mapped[str | None] = mapped_column(Text)                   # JSON list of RAG citations
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session: Mapped[ChatSession] = relationship("ChatSession", back_populates="messages")


class KnowledgeDocument(Base):
    """Uploaded lab documents (SOPs, manuals, calibration records, etc.)."""

    __tablename__ = "knowledge_docs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), default="application/octet-stream")
    doc_type: Mapped[str] = mapped_column(String(50), default="general")  # sop | manual | calibration | invoice | policy
    status: Mapped[str] = mapped_column(String(20), default=DocStatus.PENDING)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    file_path: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    chunks: Mapped[list[DocChunk]] = relationship(
        "DocChunk", back_populates="document", cascade="all, delete-orphan"
    )


class DocChunk(Base):
    """Text chunk from a document, optionally with a precomputed embedding (stored as JSON list)."""

    __tablename__ = "doc_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doc_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_docs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_json: Mapped[str | None] = mapped_column(Text)            # JSON float array (1536-dim)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    document: Mapped[KnowledgeDocument] = relationship("KnowledgeDocument", back_populates="chunks")


# avoid circular import — User is defined in app.models.user
from app.models.user import User  # noqa: E402, F401
