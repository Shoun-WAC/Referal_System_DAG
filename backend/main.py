import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import SessionLocal, engine, get_db, Base
from fraud import log_fraud
from graph import append_edge, get_redis, has_path, load_from_redis, rebuild_from_db, save_to_redis
from models import FraudLog, Referral, RewardTransaction, User
from rewards import distribute_rewards
from schemas import (
    ClaimIn,
    DashboardMetrics,
    FeedItem,
    FraudFlagsResponse,
    GraphEdge,
    GraphNode,
    GraphOut,
    UserCreate,
    UserCreateOut,
    UserOut,
)

VELOCITY_LIMIT = int(os.getenv("VELOCITY_LIMIT", "5"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as session:
        r = await get_redis()
        try:
            await rebuild_from_db(session, r)
        finally:
            await r.aclose()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.post("/referral/claim")
async def referral_claim(body: ClaimIn, db: AsyncSession = Depends(get_db)):
    new_id, ref_id = body.new_user_id, body.referrer_id
    nu = await db.get(User, new_id)
    if not nu:
        raise HTTPException(404, "new_user not found")
    ref = await db.get(User, ref_id)
    if not ref:
        raise HTTPException(404, "referrer not found")
    r = await get_redis()
    try:
        # STEP 1
        if new_id == ref_id:
            await log_fraud(db, new_id, ref_id, "self_referral")
            nu.status = "root"
            nu.referrer_id = None
            db.add(Referral(child_id=new_id, parent_id=ref_id, status="rejected", rejection_reason="self_referral"))
            await db.commit()
            await rebuild_from_db(db, r)
            return JSONResponse(
                status_code=400,
                content={"error": "self_referral", "action": "assigned_as_root"},
            )

        # STEP 2
        vk = f"velocity:{ref_id}"
        cnt = await r.incr(vk)
        if cnt == 1:
            await r.expire(vk, 60)
        if cnt > VELOCITY_LIMIT:
            await log_fraud(db, new_id, ref_id, "velocity")
            await db.commit()
            return JSONResponse(status_code=429, content={"error": "velocity_limit"})

        # STEP 3
        adj = await load_from_redis(r)
        if not adj:
            adj = await rebuild_from_db(db, r)
        if has_path(adj, str(ref_id), str(new_id)):
            await log_fraud(db, new_id, ref_id, "cycle")
            nu.status = "flagged"
            nu.referrer_id = None
            db.add(Referral(child_id=new_id, parent_id=ref_id, status="rejected", rejection_reason="cycle"))
            await db.commit()
            await rebuild_from_db(db, r)
            return JSONResponse(
                status_code=409,
                content={"error": "cycle_detected", "action": "flagged"},
            )

        # STEP 4
        nu.referrer_id = ref_id
        db.add(Referral(child_id=new_id, parent_id=ref_id, status="valid", rejection_reason=None))
        await distribute_rewards(db, new_id, ref_id, depth=3)
        await db.commit()
        adj = await load_from_redis(r)
        append_edge(adj, str(ref_id), str(new_id))
        await save_to_redis(r, adj)
        return {"status": "committed"}
    finally:
        await r.aclose()


@app.get("/user/{uid}/graph", response_model=GraphOut)
async def user_graph(uid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    root = await db.get(User, uid)
    if not root:
        raise HTTPException(404)
    ids: set[uuid.UUID] = {uid}
    cur = root.referrer_id
    while cur:
        ids.add(cur)
        p = await db.get(User, cur)
        cur = p.referrer_id if p else None

    async def children(pid: uuid.UUID) -> list[uuid.UUID]:
        q = await db.execute(select(User.user_id).where(User.referrer_id == pid))
        return [x[0] for x in q.all()]

    stack = [uid]
    while stack:
        p = stack.pop()
        for c in await children(p):
            if c not in ids:
                ids.add(c)
                stack.append(c)

    users = {u.user_id: u for u in (await db.execute(select(User).where(User.user_id.in_(ids)))).scalars()}
    nodes = [
        GraphNode(
            id=str(i),
            label=users[i].username,
            status=users[i].status,
            balance=float(users[i].reward_balance or 0),
        )
        for i in ids
        if i in users
    ]
    edges: list[GraphEdge] = []
    ref_rows = (
        await db.execute(select(Referral).where(Referral.child_id.in_(ids), Referral.parent_id.in_(ids)))
    ).scalars()
    for rr in ref_rows:
        edges.append(
            GraphEdge(
                source=str(rr.parent_id),
                target=str(rr.child_id),
                level=1,
                valid=(rr.status == "valid"),
            )
        )
    return GraphOut(nodes=nodes, edges=edges)


@app.get("/user/{uid}/rewards")
async def user_rewards(uid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, uid)
    if not u:
        raise HTTPException(404)
    txs = (
        await db.execute(
            select(RewardTransaction).where(RewardTransaction.to_user == uid).order_by(RewardTransaction.created_at.desc())
        )
    ).scalars()
    return {
        "balance": float(u.reward_balance or 0),
        "transactions": [
            {
                "from": str(t.from_user),
                "amount": float(t.amount),
                "level": t.depth_level,
                "created_at": t.created_at.isoformat() if t.created_at else "",
            }
            for t in txs
        ],
    }


@app.get("/fraud/flags", response_model=FraudFlagsResponse)
async def fraud_flags(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(FraudLog).order_by(FraudLog.timestamp.desc()).limit(200))).scalars()
    return FraudFlagsResponse(
        flags=[
            {
                "attempted_by": x.attempted_by,
                "attempted_ref": x.attempted_ref,
                "reason": x.reason,
                "timestamp": x.timestamp,
            }
            for x in rows
        ]
    )


@app.get("/dashboard/metrics", response_model=DashboardMetrics)
async def dashboard(db: AsyncSession = Depends(get_db)):
    tu = (await db.execute(select(func.count(User.user_id)))).scalar_one()
    tr = (await db.execute(select(func.count(Referral.id)))).scalar_one()
    vr = (await db.execute(select(func.count(Referral.id)).where(Referral.status == "valid"))).scalar_one()
    rr = (await db.execute(select(func.count(Referral.id)).where(Referral.status == "rejected"))).scalar_one()
    fa = (await db.execute(select(func.count(FraudLog.id)))).scalar_one()
    tot = (await db.execute(select(func.coalesce(func.sum(RewardTransaction.amount), 0)))).scalar_one()
    by_depth = (await db.execute(select(RewardTransaction.depth_level, func.sum(RewardTransaction.amount)).group_by(RewardTransaction.depth_level))).all()
    rbd = {str(d): float(s or 0) for d, s in by_depth}
    rot = []
    for i in range(13, -1, -1):
        day = datetime.utcnow().date() - timedelta(days=i)
        start = datetime.combine(day, datetime.min.time())
        end = start + timedelta(days=1)
        v = (
            await db.execute(
                select(func.count(Referral.id)).where(
                    Referral.status == "valid", Referral.created_at >= start, Referral.created_at < end
                )
            )
        ).scalar_one()
        rej = (
            await db.execute(
                select(func.count(Referral.id)).where(
                    Referral.status == "rejected", Referral.created_at >= start, Referral.created_at < end
                )
            )
        ).scalar_one()
        rot.append({"date": day.isoformat(), "valid": v, "rejected": rej})
    return DashboardMetrics(
        total_users=tu,
        total_referrals=tr,
        valid_referrals=vr,
        rejected_referrals=rr,
        fraud_attempts=fa,
        total_rewards_distributed=float(tot or 0),
        referrals_over_time=rot,
        rewards_by_depth=rbd,
    )


@app.post("/users", response_model=UserCreateOut)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    u = User(username=body.username, email=body.email, status="root", referrer_id=None)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    r = await get_redis()
    try:
        await rebuild_from_db(db, r)
    finally:
        await r.aclose()
    return UserCreateOut(user_id=u.user_id, username=u.username, status=u.status)


@app.get("/users", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User).order_by(User.created_at))).scalars()
    return [
        UserOut(
            user_id=u.user_id,
            username=u.username,
            status=u.status,
            balance=float(u.reward_balance or 0),
        )
        for u in rows
    ]


@app.get("/referral/feed", response_model=list[FeedItem])
async def feed(db: AsyncSession = Depends(get_db)):
    items: list[tuple[datetime, str, str]] = []
    for t in (await db.execute(select(Referral).order_by(Referral.created_at.desc()).limit(30))).scalars():
        if t.status == "valid":
            items.append((t.created_at, "valid", f"Referral accepted: {t.child_id} ← {t.parent_id}"))
        else:
            items.append((t.created_at, "blocked", f"Blocked ({t.rejection_reason}): {t.child_id} ← {t.parent_id}"))
    for t in (await db.execute(select(RewardTransaction).order_by(RewardTransaction.created_at.desc()).limit(30))).scalars():
        items.append((t.created_at, "reward", f"Reward L{t.depth_level}: {t.amount} to {t.to_user}"))
    for t in (await db.execute(select(FraudLog).order_by(FraudLog.timestamp.desc()).limit(20))).scalars():
        items.append((t.timestamp, "blocked", f"Fraud {t.reason}: by {t.attempted_by}"))
    items.sort(key=lambda x: x[0], reverse=True)
    return [
        FeedItem(type=a, message=m, timestamp=ts.isoformat() if ts else "")
        for ts, a, m in items[:50]
    ]
