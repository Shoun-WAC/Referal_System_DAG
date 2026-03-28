"""Run: python seed.py (needs DATABASE_URL + REDIS). Idempotent if Alice exists."""
import asyncio
from decimal import Decimal

from sqlalchemy import select

from database import SessionLocal, engine, Base
from graph import get_redis, rebuild_from_db
from models import FraudLog, Referral, User
from rewards import distribute_rewards


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        if (await db.execute(select(User).where(User.email == "alice@seed.local"))).scalars().first():
            print("Already seeded")
            return

        def u(name: str, email: str, status="active", ref=None):
            x = User(username=name, email=email, status=status, referrer_id=ref, reward_balance=Decimal("0"))
            db.add(x)
            return x

        alice = u("Alice", "alice@seed.local", "root")
        await db.flush()
        bob = u("Bob", "bob@seed.local")
        dave = u("Dave", "dave@seed.local")
        hal = u("Hal", "hal@seed.local")
        eve = u("Eve", "eve@seed.local")
        carol = u("Carol", "carol@seed.local")
        grace = u("Grace", "grace@seed.local")
        frank = u("Frank", "frank@seed.local", "flagged")
        await db.flush()

        bob.referrer_id = alice.user_id
        dave.referrer_id = bob.user_id
        hal.referrer_id = dave.user_id
        eve.referrer_id = bob.user_id
        carol.referrer_id = alice.user_id
        grace.referrer_id = carol.user_id
        frank.referrer_id = None

        edges = [
            (bob, alice),
            (dave, bob),
            (hal, dave),
            (eve, bob),
            (carol, alice),
            (grace, carol),
        ]
        for child, parent in edges:
            db.add(Referral(child_id=child.user_id, parent_id=parent.user_id, status="valid"))
            await distribute_rewards(db, child.user_id, parent.user_id, 3)

        db.add(Referral(child_id=frank.user_id, parent_id=carol.user_id, status="rejected", rejection_reason="cycle"))
        db.add(
            FraudLog(attempted_by=frank.user_id, attempted_ref=carol.user_id, reason="cycle"),
        )

        vx = u("VelX", "velx@seed.local")
        await db.flush()
        db.add(FraudLog(attempted_by=vx.user_id, attempted_ref=alice.user_id, reason="velocity"))
        db.add(Referral(child_id=vx.user_id, parent_id=alice.user_id, status="rejected", rejection_reason="velocity"))

        sy = u("SelfY", "selfy@seed.local")
        await db.flush()
        sy.status = "root"
        sy.referrer_id = None
        db.add(FraudLog(attempted_by=sy.user_id, attempted_ref=sy.user_id, reason="self_referral"))
        db.add(Referral(child_id=sy.user_id, parent_id=sy.user_id, status="rejected", rejection_reason="self_referral"))

        extra = u("Zed", "zed@seed.local")
        await db.flush()
        db.add(FraudLog(attempted_by=extra.user_id, attempted_ref=bob.user_id, reason="cycle"))
        db.add(FraudLog(attempted_by=grace.user_id, attempted_ref=hal.user_id, reason="cycle"))

        await db.commit()

    async with SessionLocal() as db:
        r = await get_redis()
        try:
            await rebuild_from_db(db, r)
        finally:
            await r.aclose()
    print("Seed done")


if __name__ == "__main__":
    asyncio.run(main())
