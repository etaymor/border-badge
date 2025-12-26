"""Blocking system endpoints."""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter

logger = logging.getLogger(__name__)

router = APIRouter()


class BlockResponse(BaseModel):
    """Response after block/unblock action."""

    status: str
    blocked_id: str


class BlockedUserSummary(BaseModel):
    """Blocked user summary for lists."""

    id: str
    user_id: str
    username: str
    avatar_url: str | None = None


@router.post("/{user_id}", status_code=201)
@limiter.limit("30/minute")
async def block_user(
    request: Request,
    user_id: UUID,
    user: CurrentUser,
) -> BlockResponse:
    """
    Block a user.

    This will:
    1. Remove any follow relationship in both directions
    2. Create a block record

    Security: Idempotent - returns 200 if already blocked.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Prevent self-block
    if str(user_id) == str(user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot block yourself",
        )

    # Check if already blocked
    existing = await db.get(
        "user_block",
        {
            "select": "id",
            "blocker_id": f"eq.{user.id}",
            "blocked_id": f"eq.{user_id}",
        },
    )

    if existing:
        return BlockResponse(status="already_blocked", blocked_id=str(user_id))

    # Check if target user exists
    target_user = await db.get(
        "user_profile",
        {
            "select": "id",
            "user_id": f"eq.{user_id}",
        },
    )

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Remove follows in both directions (if any exist)
    await db.delete(
        "user_follow",
        {
            "or": f"(follower_id.eq.{user.id},following_id.eq.{user_id}),"
            f"(follower_id.eq.{user_id},following_id.eq.{user.id})",
        },
    )

    # Create block record
    await db.post(
        "user_block",
        {
            "blocker_id": str(user.id),
            "blocked_id": str(user_id),
        },
    )

    return BlockResponse(status="blocked", blocked_id=str(user_id))


@router.delete("/{user_id}")
@limiter.limit("30/minute")
async def unblock_user(
    request: Request,
    user_id: UUID,
    user: CurrentUser,
) -> BlockResponse:
    """Unblock a user."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Delete the block record (idempotent)
    await db.delete(
        "user_block",
        {
            "blocker_id": f"eq.{user.id}",
            "blocked_id": f"eq.{user_id}",
        },
    )

    return BlockResponse(status="unblocked", blocked_id=str(user_id))


@router.get("", response_model=list[BlockedUserSummary])
@limiter.limit("30/minute")
async def get_blocked_users(
    request: Request,
    user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[BlockedUserSummary]:
    """Get list of users the current user has blocked."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Get block records
    blocks = await db.get(
        "user_block",
        {
            "select": "blocked_id,created_at",
            "blocker_id": f"eq.{user.id}",
            "order": "created_at.desc",
            "limit": limit,
            "offset": offset,
        },
    )

    if not blocks:
        return []

    # Get user profiles
    blocked_ids = [b["blocked_id"] for b in blocks]
    profiles = await db.get(
        "user_profile",
        {
            "select": "id,user_id,username,avatar_url",
            "user_id": f"in.({','.join(blocked_ids)})",
        },
    )

    if not profiles:
        return []

    return [
        BlockedUserSummary(
            id=profile["id"],
            user_id=profile["user_id"],
            username=profile["username"],
            avatar_url=profile.get("avatar_url"),
        )
        for profile in profiles
    ]
