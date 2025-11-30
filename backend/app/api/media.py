"""Media file endpoints."""

import logging
import uuid as uuid_mod
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from app.api.utils import get_token_from_request
from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.session import get_http_client, get_supabase_client
from app.schemas.media import (
    MediaFile,
    MediaStatus,
    MediaStatusUpdate,
    SignedUrlRequest,
    SignedUrlResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/signed-url", response_model=SignedUrlResponse)
async def get_signed_upload_url(
    request: Request,
    data: SignedUrlRequest,
    user: CurrentUser,
) -> SignedUrlResponse:
    """Get a signed URL for uploading a media file.

    Creates a media record in 'processing' status and returns
    a presigned URL for direct upload to Supabase Storage.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    settings = get_settings()

    # Ensure Supabase URL is configured before generating upload URLs.
    # The Settings validator allows an empty URL for local development without Supabase,
    # but this endpoint requires a fully qualified Supabase URL.
    if not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase URL is not configured on the server; media uploads are currently disabled.",
        )

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

    # Generate signed upload URL via Supabase Storage API.
    # NOTE: The actual URL format depends on Supabase Storage bucket setup.
    # We intentionally require a fully-qualified Supabase URL so that clients
    # always receive an absolute URL rather than a relative path.
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
    """Delete a media file record and its storage objects."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    settings = get_settings()

    # Fetch record to get file paths before deletion
    media = await db.get("media_files", {"id": f"eq.{media_id}"})
    if not media:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Media not found",
        )

    media_record = media[0]
    file_path = media_record["file_path"]
    thumbnail_path = media_record.get("thumbnail_path")

    # Delete from storage (use httpx client)
    client = get_http_client()
    storage_headers = {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {token}"
        if token
        else f"Bearer {settings.supabase_service_role_key}",
    }

    # Delete main file from storage
    if settings.supabase_url:
        try:
            storage_url = f"{settings.supabase_url}/storage/v1/object/media/{file_path}"
            response = await client.delete(storage_url, headers=storage_headers)
            # 404 is OK (already deleted/idempotent)
            if response.status_code not in (200, 204, 404):
                logger.warning(
                    f"Failed to delete storage file {file_path}: {response.status_code}"
                )
        except Exception as e:
            logger.warning(f"Storage deletion error for {file_path}: {e}")

        # Delete thumbnail if exists
        if thumbnail_path:
            try:
                thumb_url = (
                    f"{settings.supabase_url}/storage/v1/object/media/{thumbnail_path}"
                )
                await client.delete(thumb_url, headers=storage_headers)
            except Exception as e:
                logger.warning(f"Thumbnail deletion error for {thumbnail_path}: {e}")

    # Delete DB record
    await db.delete("media_files", {"id": f"eq.{media_id}"})
