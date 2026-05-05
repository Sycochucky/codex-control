from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.entities import MessageRole
from app.schemas.task import TaskSummary


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: MessageRole
    content: str
    created_at: datetime
    updated_at: datetime


class CreateThreadRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    initial_message: str | None = Field(default=None, min_length=1)


class ReplyRequest(BaseModel):
    content: str = Field(min_length=1)


class ThreadSummary(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    last_message_preview: str | None = None
    task: TaskSummary | None = None


class ThreadDetail(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[MessageRead]
    task: TaskSummary | None = None

