"""Physical deletion of quiz-owned storage objects (U10, R15).

Quiz photos are quiz-owned copies under `quiz/{quiz_id}/` in the public
`media` bucket with NO media_files rows -- nothing else garbage-collects
them. This module is the single sweep shared by revoke (phase two of the
two-phase revoke, KTD7), draft deletion, and account deletion.

Contract: callers set their serving gate FIRST (revoked_at / the row-delete
claim); this sweep then lists the ACTUAL storage prefix (not just the paths
the DB remembers -- swap leftovers count too), deletes every object, and
RE-LISTS to verify emptiness. Per-object 404s are tolerated (idempotent
retry); any other failure raises QuizStorageDeletionError. Deliberately NOT
the `delete_media` swallow-and-proceed shape: a sweep either verifiably
empties the prefix or it fails loudly for the caller's reconciliation
surface.
"""

import logging
from uuid import UUID

import httpx

from app.core.config import Settings, get_settings
from app.core.http_client import get_http_client

logger = logging.getLogger(__name__)

# One page covers any quiz prefix comfortably: at most 10 questions plus a
# bounded handful of swap leftovers ever live under quiz/{id}/.
_LIST_LIMIT = 1000


class QuizStorageDeletionError(Exception):
    """The quiz/{quiz_id}/ prefix could not be verifiably emptied."""


def _storage_headers(settings: Settings) -> dict[str, str]:
    # Service role: quiz storage prefixes are user-anonymous and
    # backend-owned; storage RLS knows nothing about quiz ownership.
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }


async def _list_object_paths(
    client: httpx.AsyncClient, settings: Settings, quiz_id: UUID | str
) -> list[str]:
    """Full storage paths of every object currently under quiz/{quiz_id}/."""
    prefix = f"quiz/{quiz_id}"
    try:
        response = await client.post(
            f"{settings.supabase_url}/storage/v1/object/list/media",
            headers={
                **_storage_headers(settings),
                "Content-Type": "application/json",
            },
            json={"prefix": prefix, "limit": _LIST_LIMIT, "offset": 0},
        )
    except httpx.HTTPError as exc:
        raise QuizStorageDeletionError(f"listing {prefix}/ failed: {exc}") from exc
    if response.status_code != 200:
        raise QuizStorageDeletionError(
            f"listing {prefix}/ failed with status {response.status_code}"
        )
    # The list endpoint returns entry names relative to the prefix folder;
    # quiz prefixes are flat (server-minted object names), so every entry is
    # an object.
    names = [item.get("name") for item in response.json() if item.get("name")]
    return [f"{prefix}/{name}" for name in names]


async def delete_quiz_storage_objects(quiz_id: UUID | str) -> None:
    """Empty the quiz/{quiz_id}/ storage prefix and verify it is empty.

    Returns only when the prefix has been re-listed and found empty;
    raises QuizStorageDeletionError otherwise. Idempotent: an already-empty
    prefix (or 404s from a concurrent sweep) succeeds.
    """
    settings = get_settings()
    if not settings.supabase_url:
        raise QuizStorageDeletionError("Supabase storage is not configured")
    client = get_http_client()

    for path in await _list_object_paths(client, settings, quiz_id):
        try:
            response = await client.delete(
                f"{settings.supabase_url}/storage/v1/object/media/{path}",
                headers=_storage_headers(settings),
            )
        except httpx.HTTPError as exc:
            raise QuizStorageDeletionError(f"deleting {path} failed: {exc}") from exc
        # 404 tolerated: a previous or concurrent sweep already removed it.
        if response.status_code not in (200, 204, 404):
            raise QuizStorageDeletionError(
                f"deleting {path} failed with status {response.status_code}"
            )

    remaining = await _list_object_paths(client, settings, quiz_id)
    if remaining:
        raise QuizStorageDeletionError(
            f"prefix quiz/{quiz_id}/ still holds {len(remaining)} object(s) "
            "after deletion"
        )
