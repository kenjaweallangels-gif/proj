"""Аутентификация и авторизация.

* Пароли — bcrypt.
* Доступ — JWT (access + refresh), в токене только id и версия (token_version),
  так что смена пароля / блокировка мгновенно инвалидирует все выданные токены.
* Авторизация — RBAC по правам вида "domain:action" (например "bom:write").
  Роли и наборы прав хранятся в БД и редактируются администратором.
* Плюс ABAC-элемент: уровень допуска пользователя (clearance) против
  уровня конфиденциальности изделия.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# ----------------------------------------------------------- права ----------
# domain:action. "*" — всё. Список используется в UI админки и в seed-ролях.
PERMISSIONS: dict[str, str] = {
    "items:read": "Просмотр номенклатуры и составов",
    "items:write": "Создание/правка номенклатуры",
    "bom:write": "Правка состава черновых ревизий",
    "ecn:create": "Создание извещений об изменении",
    "ecn:approve": "Согласование извещений",
    "ecn:implement": "Проведение извещений (выпуск ревизий)",
    "plan:read": "Просмотр товарного плана и планирования",
    "plan:write": "Ведение товарного плана, запуск MRP",
    "kits:read": "Просмотр комплектов",
    "kits:write": "Ведение комплектов и отметок комплектации",
    "wo:read": "Просмотр производственных заданий",
    "wo:write": "Ведение производственных заданий",
    "stock:read": "Просмотр склада",
    "stock:write": "Складские операции (приход/выдача/списание)",
    "purchase:read": "Просмотр закупок и кооперации",
    "purchase:write": "Ведение заказов поставщикам/кооператорам",
    "qc:write": "Входной контроль (решения ОТК)",
    "finance:read": "Себестоимость, проводки",
    "finance:write": "Корректировка проводок/ставок",
    "analytics:read": "Аналитика и прогнозы",
    "import:run": "Импорт из Excel / интеграции",
    "ai:use": "Использование ИИ-ассистента",
    "ai:cloud": "Разрешение облачного ИИ (для неконфиденциальных данных)",
    "admin:users": "Управление пользователями и ролями",
    "admin:integrations": "Настройка интеграций",
    "audit:read": "Просмотр журнала аудита",
}


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_token(user: User, kind: str = "access") -> str:
    s = get_settings()
    delta = timedelta(minutes=s.access_token_minutes) if kind == "access" else timedelta(days=s.refresh_token_days)
    payload = {"sub": str(user.id), "v": user.token_version, "kind": kind, "exp": _now() + delta, "iat": _now()}
    return jwt.encode(payload, s.secret_key, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недействительный токен")


def get_current_user(token: str | None = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется вход в систему")
    data = decode_token(token)
    if data.get("kind") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен access-токен")
    user = db.get(User, int(data["sub"]))
    if not user or not user.is_active or user.token_version != data.get("v"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия завершена")
    return user


def require(*perms: str):
    """Зависимость FastAPI: пользователь должен обладать всеми перечисленными правами."""

    def dep(user: User = Depends(get_current_user)) -> User:
        have = user.permissions
        if "*" in have:
            return user
        missing = [p for p in perms if p not in have]
        if missing:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Недостаточно прав: {', '.join(missing)}")
        return user

    return dep


def check_clearance(user: User, confidentiality: int) -> None:
    if "*" not in user.permissions and user.clearance < confidentiality:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточный уровень допуска к данным")


def authenticate(db: Session, login: str, password: str) -> User:
    s = get_settings()
    user = db.query(User).filter(User.login == login).first()
    generic = HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    if not user or not user.is_active:
        raise generic
    if user.locked_until and user.locked_until > datetime.utcnow():
        raise HTTPException(status.HTTP_423_LOCKED, "Учётная запись временно заблокирована")
    if not verify_password(password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= s.max_failed_logins:
            user.locked_until = datetime.utcnow() + timedelta(minutes=s.lockout_minutes)
            user.failed_logins = 0
        db.commit()
        raise generic
    user.failed_logins = 0
    user.locked_until = None
    db.commit()
    return user


def client_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "")
