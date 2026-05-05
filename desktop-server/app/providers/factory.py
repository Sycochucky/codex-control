from fastapi import HTTPException, status

from app.core.config import settings
from app.providers.base import CodexProvider
from app.providers.mock import MockCodexProvider
from app.providers.real import RealCodexProvider


def get_codex_provider() -> CodexProvider:
    provider_name = settings.provider_name.lower()

    if provider_name == MockCodexProvider.name:
        return MockCodexProvider()

    if provider_name == RealCodexProvider.name:
        return RealCodexProvider()

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Unsupported provider configured: {settings.provider_name}",
    )
