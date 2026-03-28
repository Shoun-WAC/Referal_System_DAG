import json
import os
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
ADJ_KEY = "adj_list"


def has_path(adj_list: dict, source: str, target: str) -> bool:
    visited: set[str] = set()
    stack = [source]
    while stack:
        node = stack.pop()
        if node == target:
            return True
        if node not in visited:
            visited.add(node)
            stack.extend(adj_list.get(node, []))
    return False


async def get_redis() -> Redis:
    return Redis.from_url(REDIS_URL, decode_responses=True)


async def load_from_redis(r: Redis) -> dict[str, list[str]]:
    raw = await r.get(ADJ_KEY)
    if not raw:
        return {}
    data = json.loads(raw)
    return {k: list(v) for k, v in data.items()}


async def save_to_redis(r: Redis, adj: dict[str, list[str]]) -> None:
    await r.set(ADJ_KEY, json.dumps(adj))


async def rebuild_from_db(session: AsyncSession, r: Redis) -> dict[str, list[str]]:
    from models import User

    res = await session.execute(select(User.user_id, User.referrer_id))
    adj: dict[str, list[str]] = {}
    for uid, ref in res.all():
        if ref is None:
            continue
        pk, parent = str(uid), str(ref)
        adj.setdefault(parent, []).append(pk)
    await save_to_redis(r, adj)
    return adj


def append_edge(adj: dict[str, list[str]], parent_id: str, child_id: str) -> None:
    adj.setdefault(parent_id, []).append(child_id)
