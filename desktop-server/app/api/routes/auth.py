from fastapi import APIRouter

from app.api.dependencies import CurrentUserDependency, SessionDependency
from app.schemas.auth import LoginRequest, LoginResponse, LogoutResponse, SessionInfo
from app.services.auth_service import get_session_info, login, logout

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
def login_route(payload: LoginRequest, session: SessionDependency) -> LoginResponse:
    return login(payload.token, payload.label, session)


@router.get("/me", response_model=SessionInfo)
def auth_me_route(current_user: CurrentUserDependency) -> SessionInfo:
    return get_session_info(current_user)


@router.post("/logout", response_model=LogoutResponse)
def logout_route(
    current_user: CurrentUserDependency,
    session: SessionDependency,
) -> LogoutResponse:
    return logout(current_user, session)
