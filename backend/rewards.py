import uuid
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import RewardTransaction, User

REWARD_CONFIG = {
    "depth": 3,
    "type": "percentage",
    "base_amount": Decimal("100"),
    "rates": {1: Decimal("10.0"), 2: Decimal("5.0"), 3: Decimal("2.5")},
}


async def get_parent(session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID | None:
    r = await session.execute(select(User.referrer_id).where(User.user_id == user_id))
    return r.scalar_one_or_none()


async def distribute_rewards(session: AsyncSession, new_user_id: uuid.UUID, referrer_id: uuid.UUID, depth: int = 3):
    current: uuid.UUID | None = referrer_id
    for level in range(1, depth + 1):
        if not current:
            break
        rate = REWARD_CONFIG["rates"][level]
        amount = REWARD_CONFIG["base_amount"] * (rate / Decimal("100"))
        session.add(
            RewardTransaction(
                from_user=new_user_id,
                to_user=current,
                amount=amount,
                depth_level=level,
            )
        )
        u = await session.get(User, current)
        if u:
            u.reward_balance = (u.reward_balance or Decimal("0")) + amount
        current = await get_parent(session, current)
