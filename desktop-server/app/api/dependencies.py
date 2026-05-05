from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from app.db.session import get_session
from app.models.entities import UserAuth
from app.services.auth_service import require_valid_session_token

SessionDependency = Annotated[Session, Depends(get_session)]

security = HTTPBearer(auto_error=False)


def require_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    session: SessionDependency,
) -> UserAuth:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    return require_valid_session_token(credentials.credentials, session)


CurrentUserDependency = Annotated[UserAuth, Depends(require_current_user)]

