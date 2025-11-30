"""Place endpoints."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.schemas.entries import Place

router = APIRouter()


def get_token_from_request(request: Request) -> str | None:
    """Extract bearer token from request headers."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


@router.get("/{place_id}", response_model=Place)
async def get_place(
    request: Request,
    place_id: UUID,
    user: CurrentUser,
) -> Place:
    """Get place metadata by ID."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    places = await db.get("place", {"id": f"eq.{place_id}"})
    if not places:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Place not found",
        )

    return Place(**places[0])
