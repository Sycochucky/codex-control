from fastapi import WebSocket
from sqlmodel import Session

from app.db.session import engine
from app.models.entities import UserAuth
from app.services.auth_service import require_valid_session_token


def require_current_user_for_websocket(websocket: WebSocket) -> UserAuth:
    token = websocket.query_params.get("token")
    if not token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()

    if not token:
        raise ValueError("Missing bearer token.")

    with Session(engine) as session:
        return require_valid_session_token(token, session)
