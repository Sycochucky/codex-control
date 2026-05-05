from app.models.entities import MessageRole, TaskStatus
from app.providers.base import (
    CodexProvider,
    ProviderContext,
    ProviderEvent,
    ProviderMessage,
    ProviderResult,
)


class MockCodexProvider(CodexProvider):
    name = "mock-codex"

    def start_task(self, context: ProviderContext) -> ProviderResult:
        events = [
            ProviderEvent(event_type="log", content="Mock provider started task."),
            ProviderEvent(event_type="progress", content="Mock provider is simulating work."),
        ]

        latest_user_message = self._get_latest_user_message(context)

        if latest_user_message is None:
            return ProviderResult(
                status=TaskStatus.WAITING_FOR_INPUT,
                messages=[
                    ProviderMessage(
                        role=MessageRole.ASSISTANT,
                        content="Mock provider is ready. Send a prompt to continue this thread.",
                    )
                ],
                events=events
                + [
                    ProviderEvent(
                        event_type="waiting_for_input",
                        content="Mock provider is waiting for the first user instruction.",
                    )
                ],
            )

        return self._build_user_driven_result(
            message=latest_user_message,
            source="initial prompt",
        )

    def append_message(self, context: ProviderContext) -> ProviderResult:
        return self._build_user_driven_result(
            message=self._get_latest_user_message(context) or "",
            source="reply",
        )

    def continue_task(self, context: ProviderContext) -> ProviderResult:
        return ProviderResult(
            status=TaskStatus.COMPLETED,
            messages=[
                ProviderMessage(
                    role=MessageRole.ASSISTANT,
                    content="Mock provider resumed the task and completed without additional input.",
                )
            ],
            events=[
                ProviderEvent(event_type="continue", content="Mock provider resumed task execution."),
                ProviderEvent(event_type="progress", content="Mock provider finished the remaining work."),
                ProviderEvent(event_type="completed", content="Mock provider completed the task."),
            ],
        )

    def _build_user_driven_result(self, message: str, source: str) -> ProviderResult:
        lowered = message.lower()
        events = [
            ProviderEvent(event_type="log", content=f"Mock provider received {source}."),
            ProviderEvent(event_type="progress", content="Mock provider is simulating progress."),
        ]

        if self._should_wait_for_input(lowered):
            return ProviderResult(
                status=TaskStatus.WAITING_FOR_INPUT,
                messages=[
                    ProviderMessage(
                        role=MessageRole.ASSISTANT,
                        content="Mock provider needs more detail before it can complete this task.",
                    )
                ],
                events=events
                + [
                    ProviderEvent(
                        event_type="waiting_for_input",
                        content="Mock provider paused and is waiting for more user input.",
                    )
                ],
            )

        return ProviderResult(
            status=TaskStatus.COMPLETED,
            messages=[
                ProviderMessage(
                    role=MessageRole.ASSISTANT,
                    content=f"Mock provider completed the task for: {message}",
                )
            ],
            events=events
            + [
                ProviderEvent(event_type="completed", content="Mock provider completed the task."),
            ],
        )

    @staticmethod
    def _should_wait_for_input(message: str) -> bool:
        return "?" in message or "clarify" in message or "more info" in message or "need more" in message

    @staticmethod
    def _get_latest_user_message(context: ProviderContext) -> str | None:
        for message in reversed(context.messages):
            if message.role == MessageRole.USER:
                return message.content

        return None
