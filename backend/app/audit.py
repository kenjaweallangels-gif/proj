from sqlalchemy.orm import Session

from .models import AuditLog


def log(db: Session, user_id: int | None, action: str, entity: str, entity_id="", details: dict | None = None, source="ui"):
    db.add(AuditLog(user_id=user_id, action=action, entity=entity, entity_id=str(entity_id), details=details or {}, source=source))
