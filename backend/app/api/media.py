"""Media file endpoints."""

import uuid as uuid_mod
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.schemas.media import (
    MediaFile,
    MediaStatus,
    MediaStatusUpdate,
    SignedUrlRequest,
    SignedUrlResponse,
)

router = APIRouter()


def get_token_from_request(request: Request) -> str | None:
    """Extract bearer token from request headers."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


@router.post("/signed-url", response_model=SignedUrlResponse)
async def get_signed_upload_url(
    request: Request,
    data: SignedUrlRequest,
    user: CurrentUser,
) -> SignedUrlResponse:
    """
    Get a signed URL for uploading a media file.

    Creates a media record in 'processing' status and returns
    a presigned URL for direct upload to Supabase Storage.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    settings = get_settings()

    # Validate that either trip_id or entry_id is provided
    if not data.trip_id and not data.entry_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either trip_id or entry_id must be provided",
        )

    # Generate unique file path
    file_id = uuid_mod.uuid4()
    ext = data.filename.split(".")[-1] if "." in data.filename else ""
    file_path = f"{user.id}/{file_id}.{ext}" if ext else f"{user.id}/{file_id}"

    # Create media record in processing state
    media_data = {
        "owner_id": user.id,
        "trip_id": str(data.trip_id) if data.trip_id else None,
        "entry_id": str(data.entry_id) if data.entry_id else None,
        "file_path": file_path,
        "status": MediaStatus.PROCESSING.value,
    }

    rows = await db.post("media_files", media_data)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create media record",
        )

    media = rows[0]

    # Generate signed upload URL via Supabase Storage API
    # The actual URL format depends on Supabase Storage bucket setup
    upload_url = f"{settings.supabase_url}/storage/v1/object/media/{file_path}"

    return SignedUrlResponse(
        media_id=media["id"],
        upload_url=upload_url,
        file_path=file_path,
    )


@router.get("/{media_id}", response_model=MediaFile)
async def get_media(
    request: Request,
    media_id: UUID,
    user: CurrentUser,
) -> MediaFile:
    """Get media file metadata."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    media = await db.get("media_files", {"id": f"eq.{media_id}"})
    if not media:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Media not found",
        )

    return MediaFile(**media[0])


@router.patch("/{media_id}", response_model=MediaFile)
async def update_media_status(
    request: Request,
    media_id: UUID,
    data: MediaStatusUpdate,
    user: CurrentUser,
) -> MediaFile:
    """
    Update media status after upload completes.

    Used by client to mark upload as complete or failed.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    update_data = {
        "status": data.status.value,
    }
    if data.thumbnail_path:
        update_data["thumbnail_path"] = data.thumbnail_path
    if data.exif:
        update_data["exif"] = data.exif

    rows = await db.patch("media_files", update_data, {"id": f"eq.{media_id}"})
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Media not found or not authorized",
        )

    return MediaFile(**rows[0])


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(
    request: Request,
    media_id: UUID,
    user: CurrentUser,
) -> None:
    """Delete a media file record."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    await db.delete("media_files", {"id": f"eq.{media_id}"})
