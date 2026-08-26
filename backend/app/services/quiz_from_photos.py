"""Build a Guess Where quiz from a folder of photos.

Drives the same lifecycle the in-app create path already owns:

    draft (building) → eligibility classify (unless --force) → quiz-owned
    storage copies → finalize questions + decoys → awaiting_owner_play

It does **not** play or share. Score-to-beat is the owner's first real
play; the public ``/q/{slug}`` is minted only by POST /quiz/{id}/share
after that play. The next tap is in the Atlasi app (My Quizzes → Play →
Share).
"""

from __future__ import annotations

import base64
import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx

from app.core.config import get_settings
from app.core.http_client import get_http_client
from app.core.quiz_landscape import QUIZ_LANDSCAPE_SET
from app.db.session import SupabaseClient
from app.services.photo_vision.quiz_classifier import (
    QuizImageOutcome,
    classify_quiz_images,
)
from app.services.quiz_decoys import QuizDecoyPoolExhausted, build_place_options
from app.services.quiz_photo_files import (
    LoadedQuizPhoto,
    country_code_from_filename,
    list_photo_paths,
    load_country_manifest,
    load_quiz_photo,
    parse_country_list,
)
from app.services.quiz_storage import delete_quiz_storage_objects

logger = logging.getLogger(__name__)

# Same bounds the finalize endpoint enforces (AE2).
MIN_QUIZ_PHOTOS = 5
MAX_QUIZ_PHOTOS = 10
QUIZ_UPLOAD_CACHE_CONTROL = "max-age=60"
_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

OWNER_PLAY_NEXT_STEP = (
    "Open Atlasi → Guess Where → My Quizzes → tap Play on the newest "
    '"Ready to play" card. After you finish, tap Share. That Share tap '
    "mints the public /q/{slug} link with your score to beat."
)


class QuizFromPhotosError(ValueError):
    """The folder cannot become a Guess Where quiz as-is."""


@dataclass(frozen=True)
class ResolvedQuizPhoto:
    """A loaded photo with country ground truth and (after classify) landscape."""

    loaded: LoadedQuizPhoto
    country_code: str
    country_source: str
    landscape: str | None = None


@dataclass(frozen=True)
class QuizFromPhotosResult:
    quiz_id: UUID
    state: str
    owner_id: str
    question_count: int
    photos: tuple[ResolvedQuizPhoto, ...]
    next_step: str = OWNER_PLAY_NEXT_STEP


ClassifyFn = Callable[[list[str]], Awaitable[list[QuizImageOutcome]]]
UploadFn = Callable[[str, bytes], Awaitable[None]]
GeocodeFn = Callable[[float, float], Awaitable[str | None]]


async def create_quiz_from_photo_folder(
    *,
    owner_id: str,
    folder: Path,
    countries: str | None = None,
    manifest: Path | None = None,
    limit: int = MAX_QUIZ_PHOTOS,
    drop_ineligible: bool = False,
    skip_eligibility: bool = False,
    db: SupabaseClient | None = None,
    classify: ClassifyFn | None = None,
    upload: UploadFn | None = None,
    geocode: GeocodeFn | None = None,
) -> QuizFromPhotosResult:
    """Photos in → stored, quiz rows out; owner still plays."""
    client = db or SupabaseClient()
    loaded = _load_folder(folder, limit=limit)
    resolved = await resolve_photo_countries(
        loaded,
        countries=countries,
        manifest=manifest,
        geocode=geocode,
    )
    country_map = await _validate_countries(
        client, [photo.country_code for photo in resolved]
    )
    await _require_owner(client, owner_id)

    if skip_eligibility:
        logger.warning(
            "Skipping eligibility classify (--force). Keeping all %d "
            "owner-picked photos (indoor/people/category not dropped).",
            len(resolved),
        )
        classified = [
            ResolvedQuizPhoto(
                loaded=photo.loaded,
                country_code=photo.country_code,
                country_source=photo.country_source,
                landscape=None,
            )
            for photo in resolved
        ]
    else:
        classify_fn = classify or classify_quiz_images
        classified = await _classify_photos(
            resolved, classify_fn, drop_ineligible=drop_ineligible
        )

    rows = await client.post("quiz", {"owner_id": owner_id})
    if not rows:
        raise QuizFromPhotosError("Failed to create quiz draft")
    quiz_id = UUID(str(rows[0]["id"]))

    try:
        await client.patch(
            "quiz",
            {"classified_count": len(classified)},
            {"id": f"eq.{quiz_id}"},
        )
        upload_fn = upload or _upload_quiz_jpeg
        stored = await _upload_photos(quiz_id, classified, upload_fn)
        await _finalize_quiz(
            client,
            quiz_id=quiz_id,
            owner_id=owner_id,
            photos=stored,
            country_map=country_map,
        )
    except Exception:
        await _best_effort_cleanup(client, quiz_id)
        raise

    return QuizFromPhotosResult(
        quiz_id=quiz_id,
        state="awaiting_owner_play",
        owner_id=owner_id,
        question_count=len(stored),
        photos=tuple(photo for photo, _path in stored),
    )


def preview_photo_folder(
    *,
    folder: Path,
    limit: int = MAX_QUIZ_PHOTOS,
) -> list[LoadedQuizPhoto]:
    """Load and size-check the folder without writing anything."""
    return _load_folder(folder, limit=limit)


async def resolve_photo_countries(
    photos: Sequence[LoadedQuizPhoto],
    *,
    countries: str | None = None,
    manifest: Path | None = None,
    geocode: GeocodeFn | None = None,
) -> list[ResolvedQuizPhoto]:
    """Attach an ISO country code to each photo.

    Priority per photo: ``--countries`` list (positional) > sidecar
    manifest > filename token > EXIF GPS reverse-geocode.
    """
    manifest_map = load_country_manifest(manifest) if manifest else {}
    listed = parse_country_list(countries, len(photos)) if countries else None
    geocode_fn = geocode or reverse_geocode_country
    resolved: list[ResolvedQuizPhoto] = []
    missing: list[str] = []

    for index, photo in enumerate(photos):
        code: str | None = None
        source = ""
        if listed is not None:
            code = listed[index]
            source = "flag"
        if code is None:
            mapped = manifest_map.get(photo.path.name)
            if mapped:
                code = mapped
                source = "manifest"
        if code is None:
            token = country_code_from_filename(photo.path.name)
            if token:
                code = token
                source = "filename"
        if code is None and photo.gps is not None:
            lat, lon = photo.gps
            geo = await geocode_fn(lat, lon)
            if geo:
                code = geo
                source = "gps"
        if code is None:
            missing.append(photo.path.name)
            continue
        resolved.append(
            ResolvedQuizPhoto(loaded=photo, country_code=code, country_source=source)
        )

    if missing:
        raise QuizFromPhotosError(
            "No country for: "
            + ", ".join(missing)
            + ". Pass --countries IT,JP,... or a manifest, or name files "
            "IT-colosseum.jpg. EXIF GPS is used only when reverse-geocoding "
            "is configured (GOOGLE_PLACES_API_KEY with Geocoding enabled)."
        )
    return resolved


async def reverse_geocode_country(lat: float, lon: float) -> str | None:
    """ISO country from GPS via Google Geocoding, or None if unavailable."""
    settings = get_settings()
    key = (settings.google_places_api_key or "").strip()
    if not key:
        return None
    client = get_http_client()
    try:
        response = await client.get(
            _GEOCODE_URL,
            params={
                "latlng": f"{lat},{lon}",
                "result_type": "country",
                "key": key,
            },
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Reverse geocode failed for %s,%s: %s", lat, lon, exc)
        return None
    if response.status_code != 200:
        logger.warning(
            "Reverse geocode HTTP %s for %s,%s", response.status_code, lat, lon
        )
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    status = payload.get("status")
    if status != "OK":
        logger.warning("Reverse geocode status %s for %s,%s", status, lat, lon)
        return None
    for result in payload.get("results") or []:
        for component in result.get("address_components") or []:
            types = component.get("types") or []
            if "country" in types:
                short = str(component.get("short_name") or "").strip().upper()
                if len(short) == 2 and short.isalpha():
                    return short
    return None


def _load_folder(folder: Path, *, limit: int) -> list[LoadedQuizPhoto]:
    if limit < MIN_QUIZ_PHOTOS or limit > MAX_QUIZ_PHOTOS:
        raise QuizFromPhotosError(
            f"A quiz needs between {MIN_QUIZ_PHOTOS} and {MAX_QUIZ_PHOTOS} "
            f"photos; --limit {limit} is out of range."
        )
    paths = list_photo_paths(folder)
    extra = len(paths) - limit
    if extra > 0:
        logger.warning(
            "Folder has %d images; using the first %d after name sort (%d unused).",
            len(paths),
            limit,
            extra,
        )
        paths = paths[:limit]
    if len(paths) < MIN_QUIZ_PHOTOS:
        raise QuizFromPhotosError(
            f"A quiz needs between {MIN_QUIZ_PHOTOS} and {MAX_QUIZ_PHOTOS} "
            f"photos; {folder} has {len(paths)}."
        )
    return [load_quiz_photo(path) for path in paths]


async def _require_owner(db: SupabaseClient, owner_id: str) -> None:
    rows = await db.get(
        "user_profile",
        {"user_id": f"eq.{owner_id}", "select": "user_id,display_name"},
    )
    if not rows:
        raise QuizFromPhotosError(
            f"No user_profile for owner_id {owner_id}. Use Emerson's auth "
            "user id so the quiz appears under My Quizzes."
        )


async def _validate_countries(
    db: SupabaseClient, codes: list[str]
) -> dict[str, dict[str, Any]]:
    unique = sorted(set(codes))
    rows = await db.get(
        "country",
        {"code": f"in.({','.join(unique)})", "select": "code,name,region,subregion"},
    )
    found = {str(row["code"]).upper(): row for row in rows}
    missing = [code for code in unique if code not in found]
    if missing:
        raise QuizFromPhotosError(
            f"Unknown country code(s) (not in public.country): {', '.join(missing)}"
        )
    return found


async def _classify_photos(
    photos: Sequence[ResolvedQuizPhoto],
    classify_fn: ClassifyFn,
    *,
    drop_ineligible: bool,
) -> list[ResolvedQuizPhoto]:
    images = [
        base64.b64encode(photo.loaded.vision_jpeg).decode("ascii") for photo in photos
    ]
    outcomes = await classify_fn(images)
    if len(outcomes) < len(photos):
        outcomes = [
            *outcomes,
            *[QuizImageOutcome(result=None, retryable=False)]
            * (len(photos) - len(outcomes)),
        ]

    kept: list[ResolvedQuizPhoto] = []
    rejected: list[str] = []
    retryable: list[str] = []
    for photo, outcome in zip(photos, outcomes, strict=False):
        name = photo.loaded.path.name
        if outcome.retryable:
            retryable.append(name)
            continue
        result = outcome.result
        if result is None or not result.eligible:
            reason = _ineligible_reason(outcome)
            rejected.append(f"{name} ({reason})")
            continue
        landscape = result.landscape if result.landscape in QUIZ_LANDSCAPE_SET else None
        kept.append(
            ResolvedQuizPhoto(
                loaded=photo.loaded,
                country_code=photo.country_code,
                country_source=photo.country_source,
                landscape=landscape,
            )
        )

    if retryable:
        raise QuizFromPhotosError(
            "Eligibility classification was unavailable for: "
            + ", ".join(retryable)
            + ". Check OPENROUTER_API_KEY and retry."
        )
    if rejected and not drop_ineligible:
        raise QuizFromPhotosError(
            "Classifier rejected photos that would ship in the TikTok set: "
            + "; ".join(rejected)
            + ". Swap those files or pass --drop-ineligible if you want "
            "the remaining eligible photos."
        )
    if rejected:
        logger.warning("Dropped ineligible photos: %s", "; ".join(rejected))
    if not MIN_QUIZ_PHOTOS <= len(kept) <= MAX_QUIZ_PHOTOS:
        raise QuizFromPhotosError(
            f"A quiz needs between {MIN_QUIZ_PHOTOS} and {MAX_QUIZ_PHOTOS} "
            f"eligible photos; {len(kept)} remain after classification."
        )
    return kept


def _ineligible_reason(outcome: QuizImageOutcome) -> str:
    result = outcome.result
    if result is None:
        return "unclassifiable"
    if result.has_people:
        return "people_present"
    if result.setting != "outdoor":
        return "indoor"
    return "category_not_allowed"


async def _upload_photos(
    quiz_id: UUID,
    photos: Sequence[ResolvedQuizPhoto],
    upload_fn: UploadFn,
) -> list[tuple[ResolvedQuizPhoto, str]]:
    stored: list[tuple[ResolvedQuizPhoto, str]] = []
    for photo in photos:
        storage_path = f"quiz/{quiz_id}/{uuid.uuid4().hex}.jpg"
        await upload_fn(storage_path, photo.loaded.upload_jpeg)
        stored.append((photo, storage_path))
    return stored


async def _upload_quiz_jpeg(storage_path: str, jpeg: bytes) -> None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise QuizFromPhotosError("Supabase storage is not configured")
    client = get_http_client()
    url = f"{settings.supabase_url}/storage/v1/object/media/{storage_path}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "image/jpeg",
        "cache-control": QUIZ_UPLOAD_CACHE_CONTROL,
    }
    response = await client.put(url, headers=headers, content=jpeg)
    if response.status_code not in (200, 201):
        raise QuizFromPhotosError(
            f"Storage upload failed for {storage_path} (HTTP {response.status_code})"
        )


async def _finalize_quiz(
    db: SupabaseClient,
    *,
    quiz_id: UUID,
    owner_id: str,
    photos: Sequence[tuple[ResolvedQuizPhoto, str]],
    country_map: dict[str, dict[str, Any]],
) -> None:
    """Same write sequence as POST /quiz/{id}/finalize: claim, then questions."""
    try:
        option_sets = await build_place_options(
            db,
            [country_map[photo.country_code] for photo, _path in photos],
            owner_id=owner_id,
            landscapes=[photo.landscape for photo, _path in photos],
        )
    except QuizDecoyPoolExhausted as exc:
        raise QuizFromPhotosError(
            "Not enough countries available to build quiz options"
        ) from exc

    claimed = await db.patch(
        "quiz",
        {"state": "awaiting_owner_play", "updated_at": _now_iso()},
        {
            "id": f"eq.{quiz_id}",
            "owner_id": f"eq.{owner_id}",
            "state": "eq.building",
        },
    )
    if not claimed:
        raise QuizFromPhotosError("Draft was finalized by another writer")

    question_rows = [
        {
            "quiz_id": str(quiz_id),
            "position": position,
            "storage_path": storage_path,
            "options": options,
            "correct_index": correct_index,
        }
        for position, ((_photo, storage_path), (options, correct_index)) in enumerate(
            zip(photos, option_sets, strict=True)
        )
    ]
    try:
        await db.delete("quiz_question", {"quiz_id": f"eq.{quiz_id}"})
        inserted = await db.post("quiz_question", question_rows)
        if len(inserted) != len(question_rows):
            raise QuizFromPhotosError("Failed to store quiz questions")
    except Exception:
        await db.patch(
            "quiz",
            {"state": "building", "updated_at": _now_iso()},
            {
                "id": f"eq.{quiz_id}",
                "owner_id": f"eq.{owner_id}",
                "state": "eq.awaiting_owner_play",
            },
        )
        raise


async def _best_effort_cleanup(db: SupabaseClient, quiz_id: UUID) -> None:
    try:
        await delete_quiz_storage_objects(quiz_id)
    except Exception as exc:
        logger.warning("Could not sweep storage for failed quiz %s: %s", quiz_id, exc)
    try:
        await db.delete("quiz", {"id": f"eq.{quiz_id}"})
    except Exception as exc:
        logger.warning("Could not delete failed quiz draft %s: %s", quiz_id, exc)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()
