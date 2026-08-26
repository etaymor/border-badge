#!/usr/bin/env python3
"""Create a Guess Where quiz from a folder of travel photos.

This is the thinnest server path that reuses the existing Atlasi Guess Where
system. It does not invent a new game and it does not mint a public /q/ slug:
owner play is still a real in-app play so there is a score to beat.

    photos → storage copies → eligibility classify → quiz_question rows
          → state awaiting_owner_play

Then Emerson plays and shares in the app. That Share tap is what publishes
https://atlasi.app/q/{slug}.

Usage (from backend/, with backend/.env loaded automatically):

    poetry run python scripts/create_quiz_from_photos.py \\
      --owner-id 578c63c4-c324-47f1-b3fa-2672e8cb5821 \\
      --photos /path/to/tiktok-slideshow \\
      --countries EG,FR,TR,ME,MY,PA,GB,AT,IT,JP \\
      --force

Country ground truth (required; same role as GPS in the in-app flow):

  1. --countries IT,JP,...   positional, sorted-filename order
  2. --manifest countries.json or countries.csv
  3. Filename token: IT-colosseum.jpg, 01_JP.jpg, fuji-JP.jpg
  4. EXIF GPS reverse-geocode when GOOGLE_PLACES_API_KEY has Geocoding enabled

Emerson's user id (the owner of the live /q/5f769a49... quiz):

    578c63c4-c324-47f1-b3fa-2672e8cb5821

After a successful run:

    Open Atlasi → Guess Where → My Quizzes → Play on the newest
    "Ready to play" card → Share.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.http_client import close_http_client  # noqa: E402
from app.services.quiz_from_photos import (  # noqa: E402
    OWNER_PLAY_NEXT_STEP,
    QuizFromPhotosError,
    create_quiz_from_photo_folder,
    preview_photo_folder,
    resolve_photo_countries,
)
from app.services.quiz_photo_files import QuizPhotoFileError  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# The owner of the live shared example at atlasi.app/q/5f769a49ca1437abd1f33b0ccd3fd528.
EMERSON_OWNER_ID = "578c63c4-c324-47f1-b3fa-2672e8cb5821"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Build a Guess Where quiz from a folder of photos and leave it "
            "at awaiting_owner_play for Emerson to play and share in the app."
        )
    )
    parser.add_argument(
        "--owner-id",
        required=True,
        help=(f"auth.users id that will own the quiz. Emerson: {EMERSON_OWNER_ID}"),
    )
    parser.add_argument(
        "--photos",
        required=True,
        type=Path,
        help="Folder of JPEG/HEIC/PNG/WebP photos (5-10 used, name-sorted).",
    )
    parser.add_argument(
        "--countries",
        help="Comma-separated ISO codes in the same order as the sorted files.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        help="JSON or CSV mapping filename → country_code.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="How many photos to take from the folder after name sort (5-10).",
    )
    parser.add_argument(
        "--drop-ineligible",
        action="store_true",
        help=(
            "Drop classifier-rejected photos instead of failing. Default is "
            "fail-closed so a TikTok slideshow photo cannot silently vanish."
        ),
    )
    parser.add_argument(
        "--force",
        "--skip-eligibility",
        dest="skip_eligibility",
        action="store_true",
        help=(
            "Keep every owner-picked still. Skip indoor/people/category "
            "rejects. Country ground truth is still required. Default is "
            "fail-closed."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Load photos and resolve countries; do not classify or write.",
    )
    return parser


def _validate_owner_id(raw: str) -> str:
    try:
        return str(UUID(raw))
    except ValueError as exc:
        raise SystemExit(f"--owner-id is not a UUID: {raw}") from exc


async def _run_create(args: argparse.Namespace) -> int:
    owner_id = _validate_owner_id(args.owner_id)
    folder: Path = args.photos.expanduser().resolve()
    manifest = args.manifest.expanduser().resolve() if args.manifest else None

    try:
        loaded = preview_photo_folder(folder=folder, limit=args.limit)
        resolved = await resolve_photo_countries(
            loaded, countries=args.countries, manifest=manifest
        )
    except (QuizFromPhotosError, QuizPhotoFileError) as exc:
        logger.error("%s", exc)
        return 1

    logger.info("Resolved %d photo(s) from %s", len(resolved), folder)
    for photo in resolved:
        gps = (
            f" gps={photo.loaded.gps[0]:.4f},{photo.loaded.gps[1]:.4f}"
            if photo.loaded.gps
            else ""
        )
        logger.info(
            "  %s  %s  (%s)%s",
            photo.loaded.path.name,
            photo.country_code,
            photo.country_source,
            gps,
        )

    if args.dry_run:
        logger.info("Dry run: no classification, storage, or quiz rows written.")
        return 0

    try:
        result = await create_quiz_from_photo_folder(
            owner_id=owner_id,
            folder=folder,
            countries=args.countries,
            manifest=manifest,
            limit=args.limit,
            drop_ineligible=args.drop_ineligible,
            skip_eligibility=args.skip_eligibility,
        )
    except (QuizFromPhotosError, QuizPhotoFileError) as exc:
        logger.error("%s", exc)
        return 1

    logger.info(
        "Quiz %s  state=%s  questions=%d  owner=%s",
        result.quiz_id,
        result.state,
        result.question_count,
        result.owner_id,
    )
    logger.info("NEXT TAP: %s", OWNER_PLAY_NEXT_STEP)
    return 0


async def _run(args: argparse.Namespace) -> int:
    try:
        return await _run_create(args)
    finally:
        await close_http_client()


def main() -> int:
    args = build_parser().parse_args()
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
