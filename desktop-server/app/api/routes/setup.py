from fastapi import APIRouter

from app.api.dependencies import CurrentUserDependency
from app.schemas.setup import GitHubDeviceLoginStartResponse, GitHubDeviceLoginStatusResponse, SetupStatusResponse
from app.services.setup_service import collect_setup_status, get_github_device_login_status, start_github_device_login

router = APIRouter()


@router.get("/status", response_model=SetupStatusResponse)
async def setup_status_route(_: CurrentUserDependency) -> SetupStatusResponse:
    return await collect_setup_status()


@router.post("/github/login/start", response_model=GitHubDeviceLoginStartResponse)
async def github_login_start_route(_: CurrentUserDependency) -> GitHubDeviceLoginStartResponse:
    return await start_github_device_login()


@router.get("/github/login/{flow_id}", response_model=GitHubDeviceLoginStatusResponse)
async def github_login_status_route(
    flow_id: str,
    _: CurrentUserDependency,
) -> GitHubDeviceLoginStatusResponse:
    return await get_github_device_login_status(flow_id)

