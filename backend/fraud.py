import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from models import FraudLog


async def log_fraud(session: AsyncSession, attempted_by: uuid.UUID, attempted_ref: uuid.UUID, reason: str):
    session.add(FraudLog(attempted_by=attempted_by, attempted_ref=attempted_ref, reason=reason))
