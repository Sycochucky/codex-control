from datetime import datetime

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    token: str
    label: str | None = Field(default=None, min_length=1, max_length=100)


class LoginResponse(BaseModel):
    token: str
    token_type: str = "bearer"
    label: str
    expires_at: datetime


class SessionInfo(BaseModel):
    label: str
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime


class LogoutResponse(BaseModel):
    success: bool = True
