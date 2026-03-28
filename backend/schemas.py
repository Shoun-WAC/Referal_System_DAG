from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class ClaimIn(BaseModel):
    new_user_id: UUID
    referrer_id: UUID


class UserCreate(BaseModel):
    username: str
    email: str


class UserOut(BaseModel):
    user_id: UUID
    username: str
    status: str
    balance: float


class UserCreateOut(BaseModel):
    user_id: UUID
    username: str
    status: str


class GraphNode(BaseModel):
    id: str
    label: str
    status: str
    balance: float


class GraphEdge(BaseModel):
    source: str
    target: str
    level: int
    valid: bool


class GraphOut(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class FraudFlagOut(BaseModel):
    attempted_by: UUID
    attempted_ref: UUID
    reason: str
    timestamp: datetime


class FraudFlagsResponse(BaseModel):
    flags: list[FraudFlagOut]


class DashboardMetrics(BaseModel):
    total_users: int
    total_referrals: int
    valid_referrals: int
    rejected_referrals: int
    fraud_attempts: int
    total_rewards_distributed: float
    referrals_over_time: list[dict]
    rewards_by_depth: dict[str, float]


class FeedItem(BaseModel):
    type: str
    message: str
    timestamp: str
