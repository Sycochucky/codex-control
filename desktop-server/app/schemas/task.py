from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.entities import TaskStatus


class TaskEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    content: str
    created_at: datetime
    updated_at: datetime


class TaskSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    thread_id: str
    status: TaskStatus
    provider_name: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class TaskDetail(TaskSummary):
    events: list[TaskEventRead]

