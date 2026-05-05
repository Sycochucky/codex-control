from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.models.entities import MessageRole, TaskStatus


@dataclass(frozen=True)
class ProviderMessage:
    role: MessageRole
    content: str


@dataclass(frozen=True)
class ProviderEvent:
    event_type: str
    content: str


@dataclass(frozen=True)
class ProviderConversationMessage:
    role: MessageRole
    content: str


@dataclass(frozen=True)
class ProviderContext:
    thread_title: str
    messages: list[ProviderConversationMessage] = field(default_factory=list)


@dataclass(frozen=True)
class ProviderResult:
    status: TaskStatus
    messages: list[ProviderMessage] = field(default_factory=list)
    events: list[ProviderEvent] = field(default_factory=list)


class CodexProvider(ABC):
    name: str

    @abstractmethod
    def start_task(self, context: ProviderContext) -> ProviderResult:
        raise NotImplementedError

    @abstractmethod
    def append_message(self, context: ProviderContext) -> ProviderResult:
        raise NotImplementedError

    @abstractmethod
    def continue_task(self, context: ProviderContext) -> ProviderResult:
        raise NotImplementedError
