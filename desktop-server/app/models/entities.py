from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from sqlmodel import Field, Relationship, SQLModel


def utc_now() -> datetime:
    return datetime.now(UTC)


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class TaskStatus(StrEnum):
    RUNNING = "running"
    WAITING_FOR_INPUT = "waiting_for_input"
    COMPLETED = "completed"
    FAILED = "failed"


class Thread(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    title: str = Field(index=True, max_length=200)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)

    messages: list["Message"] = Relationship(back_populates="thread")
    task_runs: list["TaskRun"] = Relationship(back_populates="thread")


class Message(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    thread_id: str = Field(foreign_key="thread.id", index=True)
    role: MessageRole = Field(nullable=False)
    content: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)

    thread: Thread | None = Relationship(back_populates="messages")


class TaskRun(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    thread_id: str = Field(foreign_key="thread.id", index=True)
    status: TaskStatus = Field(default=TaskStatus.RUNNING, nullable=False, index=True)
    provider_name: str = Field(default="phase2-skeleton", nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)
    completed_at: datetime | None = Field(default=None, nullable=True)

    thread: Thread | None = Relationship(back_populates="task_runs")
    events: list["TaskEvent"] = Relationship(back_populates="task_run")


class TaskEvent(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    task_run_id: str = Field(foreign_key="taskrun.id", index=True)
    event_type: str = Field(default="log", nullable=False, max_length=50)
    content: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)

    task_run: TaskRun | None = Relationship(back_populates="events")


class UserAuth(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    session_token: str = Field(index=True, unique=True, nullable=False)
    label: str = Field(default="local-user", nullable=False, max_length=100)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)
