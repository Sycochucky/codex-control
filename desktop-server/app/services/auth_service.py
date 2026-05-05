from datetime import UTC, datetime, timedelta
import secrets

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.config import settings
from app.models.entities import UserAuth, utc_now
from app.schemas.auth import LoginResponse, LogoutResponse, SessionInfo


def login(shared_token: str, label: str | None, session: Session) -> LoginResponse:
    if not secrets.compare_digest(shared_token, settings.shared_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid shared token.",
        )

    normalized_label = _normalize_label(label)
    _purge_expired_sessions(session)

    auth_session = UserAuth(
        session_token=secrets.token_urlsafe(48),
        label=normalized_label,
    )
    session.add(auth_session)
    session.commit()
    session.refresh(auth_session)
    _enforce_session_limit(normalized_label, session)

    return _build_login_response(auth_session)


def require_valid_session_token(session_token: str, session: Session) -> UserAuth:
    statement = select(UserAuth).where(UserAuth.session_token == session_token)
    auth_session = session.exec(statement).first()
    if auth_session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token.",
        )

    if _is_expired(auth_session):
        session.delete(auth_session)
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token.",
        )

    auth_session.updated_at = utc_now()
    session.add(auth_session)
    session.commit()
    session.refresh(auth_session)
    return auth_session


def get_session_info(auth_session: UserAuth) -> SessionInfo:
    return SessionInfo(
        label=auth_session.label,
        created_at=auth_session.created_at,
        last_used_at=auth_session.updated_at,
        expires_at=_get_expires_at(auth_session),
    )


def logout(auth_session: UserAuth, session: Session) -> LogoutResponse:
    persistent_auth_session = session.get(UserAuth, auth_session.id)
    if persistent_auth_session is not None:
        session.delete(persistent_auth_session)
        session.commit()

    return LogoutResponse()


def _normalize_label(label: str | None) -> str:
    normalized = (label or "local-user").strip()
    return normalized[:100] or "local-user"


def _get_expires_at(auth_session: UserAuth):
    return _ensure_utc(auth_session.updated_at) + timedelta(hours=settings.session_ttl_hours)


def _is_expired(auth_session: UserAuth) -> bool:
    return utc_now() >= _get_expires_at(auth_session)


def _purge_expired_sessions(session: Session) -> None:
    auth_sessions = session.exec(select(UserAuth)).all()
    removed = False

    for auth_session in auth_sessions:
        if _is_expired(auth_session):
            session.delete(auth_session)
            removed = True

    if removed:
        session.commit()


def _enforce_session_limit(label: str, session: Session) -> None:
    auth_sessions = session.exec(
        select(UserAuth)
        .where(UserAuth.label == label)
        .order_by(UserAuth.updated_at.desc())
    ).all()

    if len(auth_sessions) <= settings.max_sessions_per_label:
        return

    for auth_session in auth_sessions[settings.max_sessions_per_label :]:
        session.delete(auth_session)

    session.commit()


def _build_login_response(auth_session: UserAuth) -> LoginResponse:
    return LoginResponse(
        token=auth_session.session_token,
        label=auth_session.label,
        expires_at=_get_expires_at(auth_session),
    )


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)

    return value.astimezone(UTC)
