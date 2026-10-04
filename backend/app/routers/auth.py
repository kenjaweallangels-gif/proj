from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..models import Role, User
from ..schemas import LoginIn, RoleIn, RoleOut, TokenOut, UserIn, UserOut
from ..security import PERMISSIONS, authenticate, create_token, decode_token, get_current_user, hash_password, require

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = authenticate(db, data.login, data.password)
    audit.log(db, user.id, "login", "user", user.id)
    db.commit()
    return TokenOut(access_token=create_token(user), refresh_token=create_token(user, "refresh"))


@router.post("/refresh", response_model=TokenOut)
def refresh(refresh_token: str, db: Session = Depends(get_db)):
    data = decode_token(refresh_token)
    user = db.get(User, int(data["sub"]))
    if data.get("kind") != "refresh" or not user or not user.is_active or user.token_version != data.get("v"):
        raise HTTPException(401, "Сессия завершена")
    return TokenOut(access_token=create_token(user), refresh_token=create_token(user, "refresh"))


@router.post("/logout")
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.token_version += 1  # инвалидирует все токены пользователя
    db.commit()
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password")
def change_password(old: str, new: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from ..security import verify_password

    if not verify_password(old, user.password_hash):
        raise HTTPException(400, "Неверный текущий пароль")
    if len(new) < 8:
        raise HTTPException(400, "Пароль не короче 8 символов")
    user.password_hash = hash_password(new)
    user.token_version += 1
    db.commit()
    return {"ok": True}


# ----------------------------------------------------------------- admin ---
@admin.get("/permissions")
def permissions(_: User = Depends(require("admin:users"))):
    return PERMISSIONS


@admin.get("/roles", response_model=list[RoleOut])
def roles(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Role).order_by(Role.id).all()


@admin.post("/roles", response_model=RoleOut)
def create_role(data: RoleIn, db: Session = Depends(get_db), me: User = Depends(require("admin:users"))):
    if db.query(Role).filter(Role.code == data.code).first():
        raise HTTPException(400, "Роль с таким кодом уже есть")
    bad = [p for p in data.permissions if p not in PERMISSIONS and p != "*"]
    if bad:
        raise HTTPException(400, f"Неизвестные права: {bad}")
    r = Role(**data.model_dump())
    db.add(r)
    audit.log(db, me.id, "create", "role", data.code)
    db.commit()
    return r


@admin.put("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: int, data: RoleIn, db: Session = Depends(get_db), me: User = Depends(require("admin:users"))):
    r = db.get(Role, role_id)
    if not r:
        raise HTTPException(404)
    if r.is_system and r.code == "admin":
        raise HTTPException(400, "Роль администратора нельзя менять")
    r.name, r.description, r.permissions = data.name, data.description, data.permissions
    audit.log(db, me.id, "update", "role", r.code, {"permissions": data.permissions})
    db.commit()
    return r


@admin.get("/users", response_model=list[UserOut])
def users(db: Session = Depends(get_db), _: User = Depends(require("admin:users"))):
    return db.query(User).order_by(User.full_name).all()


@admin.post("/users", response_model=UserOut)
def create_user(data: UserIn, db: Session = Depends(get_db), me: User = Depends(require("admin:users"))):
    if db.query(User).filter(User.login == data.login).first():
        raise HTTPException(400, "Логин занят")
    if not data.password or len(data.password) < 8:
        raise HTTPException(400, "Пароль не короче 8 символов")
    u = User(login=data.login, full_name=data.full_name, email=data.email, department=data.department,
             clearance=data.clearance, is_active=data.is_active, password_hash=hash_password(data.password))
    u.roles = db.query(Role).filter(Role.code.in_(data.role_codes)).all()
    db.add(u)
    audit.log(db, me.id, "create", "user", data.login, {"roles": data.role_codes})
    db.commit()
    return u


@admin.put("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserIn, db: Session = Depends(get_db), me: User = Depends(require("admin:users"))):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404)
    u.full_name, u.email, u.department, u.clearance, u.is_active = data.full_name, data.email, data.department, data.clearance, data.is_active
    u.roles = db.query(Role).filter(Role.code.in_(data.role_codes)).all()
    if data.password:
        u.password_hash = hash_password(data.password)
        u.token_version += 1
    if not data.is_active:
        u.token_version += 1
    audit.log(db, me.id, "update", "user", u.login, {"roles": data.role_codes, "active": data.is_active})
    db.commit()
    return u


@admin.get("/audit")
def audit_log(limit: int = 200, entity: str | None = None, db: Session = Depends(get_db), _: User = Depends(require("audit:read"))):
    from ..models import AuditLog

    q = db.query(AuditLog).order_by(AuditLog.id.desc())
    if entity:
        q = q.filter(AuditLog.entity == entity)
    rows = q.limit(limit).all()
    users = {u.id: u.full_name for u in db.query(User).all()}
    return [{"id": r.id, "ts": r.ts, "user": users.get(r.user_id, "—"), "action": r.action, "entity": r.entity,
             "entity_id": r.entity_id, "details": r.details, "source": r.source} for r in rows]
