"""Folder-fed Guess Where create path: files in, awaiting_owner_play out."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from PIL import Image

from app.services.photo_vision.quiz_classifier import QuizImageOutcome, QuizVisionResult
from app.services.quiz_from_photos import (
    OWNER_PLAY_NEXT_STEP,
    QuizFromPhotosError,
    create_quiz_from_photo_folder,
    resolve_photo_countries,
)
from app.services.quiz_photo_files import (
    QuizPhotoFileError,
    country_code_from_filename,
    gps_from_exif_ifd,
    list_photo_paths,
    load_country_manifest,
    load_quiz_photo,
    parse_country_list,
)

OWNER_ID = "578c63c4-c324-47f1-b3fa-2672e8cb5821"

COUNTRIES = [
    {"code": "IT", "name": "Italy", "region": "Europe", "subregion": "Southern Europe"},
    {
        "code": "JP",
        "name": "Japan",
        "region": "Asia",
        "subregion": "East & Southeast Asia",
    },
    {"code": "FR", "name": "France", "region": "Europe", "subregion": "Core Europe"},
    {"code": "ES", "name": "Spain", "region": "Europe", "subregion": "Southern Europe"},
    {
        "code": "GR",
        "name": "Greece",
        "region": "Europe",
        "subregion": "Southern Europe",
    },
    {"code": "EG", "name": "Egypt", "region": "Africa", "subregion": "North Africa"},
    {"code": "TR", "name": "Turkey", "region": "Asia", "subregion": "West Asia"},
    {
        "code": "ME",
        "name": "Montenegro",
        "region": "Europe",
        "subregion": "Southern Europe",
    },
    {
        "code": "MY",
        "name": "Malaysia",
        "region": "Asia",
        "subregion": "East & Southeast Asia",
    },
    {
        "code": "PA",
        "name": "Panama",
        "region": "Americas",
        "subregion": "Central America",
    },
    {
        "code": "GB",
        "name": "United Kingdom",
        "region": "Europe",
        "subregion": "Northern Europe",
    },
    {"code": "AT", "name": "Austria", "region": "Europe", "subregion": "Core Europe"},
]


def _jpeg_bytes(
    color: tuple[int, int, int] = (30, 80, 140), size: tuple[int, int] = (64, 48)
) -> bytes:
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def _write_photos(folder: Path, names: list[str]) -> None:
    for index, name in enumerate(names):
        color = (20 + index * 15, 60, 120)
        (folder / name).write_bytes(_jpeg_bytes(color))


def _eligible() -> QuizImageOutcome:
    return QuizImageOutcome(
        result=QuizVisionResult(
            has_people=False,
            setting="outdoor",
            category="scenery",
            landscape="mediterranean",
        )
    )


def _ineligible(reason: str = "people") -> QuizImageOutcome:
    if reason == "people":
        result = QuizVisionResult(True, "outdoor", "scenery", "other")
    elif reason == "indoor":
        # Indoor place stills are eligible; only an unclear setting fails
        # closed under the leftover "indoor" API reason.
        result = QuizVisionResult(False, "unclear", "scenery", "other")
    else:
        result = QuizVisionResult(False, "outdoor", "other", "other")
    return QuizImageOutcome(result=result)


class FakeDB:
    """Minimal service-role stand-in for the folder create path."""

    def __init__(self) -> None:
        self.quizzes: list[dict[str, Any]] = []
        self.questions: list[dict[str, Any]] = []
        self.deleted_quiz_ids: list[str] = []

    async def get(
        self, table: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        params = params or {}
        if table == "user_profile":
            user_id = str(params.get("user_id", "")).removeprefix("eq.")
            if user_id == OWNER_ID:
                return [{"user_id": OWNER_ID, "display_name": "Emerson"}]
            return []
        if table == "country":
            raw = str(params.get("code", "")).removeprefix("in.(").removesuffix(")")
            wanted = {part.strip().upper() for part in raw.split(",") if part.strip()}
            return [row for row in COUNTRIES if row["code"] in wanted]
        if table == "user_countries":
            return []
        return []

    async def post(
        self, table: str, data: dict[str, Any] | list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        if table == "quiz":
            row = {
                "id": str(uuid4()),
                "owner_id": data["owner_id"],
                "state": "building",
                "classified_count": 0,
            }
            self.quizzes.append(row)
            return [row]
        if table == "quiz_question":
            rows = data if isinstance(data, list) else [data]
            stored = []
            for item in rows:
                row = {"id": str(uuid4()), **item}
                self.questions.append(row)
                stored.append(row)
            return stored
        return []

    async def patch(
        self, table: str, data: dict[str, Any], params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        params = params or {}
        if table != "quiz" or not self.quizzes:
            return []
        quiz = self.quizzes[-1]
        if params.get("id") and str(params["id"]).removeprefix("eq.") != quiz["id"]:
            return []
        if (
            params.get("state")
            and str(params["state"]).removeprefix("eq.") != quiz["state"]
        ):
            return []
        quiz.update(data)
        return [quiz]

    async def delete(self, table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        if table == "quiz_question":
            quiz_id = str(params.get("quiz_id", "")).removeprefix("eq.")
            removed = [row for row in self.questions if row["quiz_id"] == quiz_id]
            self.questions = [
                row for row in self.questions if row["quiz_id"] != quiz_id
            ]
            return removed
        if table == "quiz":
            quiz_id = str(params.get("id", "")).removeprefix("eq.")
            self.deleted_quiz_ids.append(quiz_id)
            self.quizzes = [row for row in self.quizzes if row["id"] != quiz_id]
            return []
        return []


# ---------------------------------------------------------------------------
# File helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("IT.jpg", "IT"),
        ("IT-colosseum.jpg", "IT"),
        ("01_JP.jpg", "JP"),
        ("01_IT_colosseum.jpg", "IT"),
        ("fuji-JP.jpg", "JP"),
        ("IMG_1234.jpg", None),
        ("photo.jpg", None),
        ("vacation.png", None),
    ],
)
def test_country_code_from_filename(name: str, expected: str | None) -> None:
    assert country_code_from_filename(name) == expected


def test_gps_from_exif_ifd_rome() -> None:
    gps = gps_from_exif_ifd(
        {
            1: "N",
            2: ((41, 1), (53, 1), (24, 1)),
            3: "E",
            4: ((12, 1), (29, 1), (32, 1)),
        }
    )
    assert gps is not None
    lat, lon = gps
    assert 41.88 < lat < 41.90
    assert 12.48 < lon < 12.50


def test_gps_southern_western_hemisphere() -> None:
    gps = gps_from_exif_ifd(
        {
            1: "S",
            2: ((33, 1), (52, 1), (0, 1)),
            3: "W",
            4: ((70, 1), (40, 1), (0, 1)),
        }
    )
    assert gps is not None
    assert gps[0] < 0
    assert gps[1] < 0


def test_load_quiz_photo_strips_to_jpeg(tmp_path: Path) -> None:
    path = tmp_path / "wide.png"
    Image.new("RGB", (3000, 1000), (10, 20, 30)).save(path)
    loaded = load_quiz_photo(path)
    upload = Image.open(io.BytesIO(loaded.upload_jpeg))
    vision = Image.open(io.BytesIO(loaded.vision_jpeg))
    assert upload.format == "JPEG"
    assert vision.format == "JPEG"
    assert max(upload.size) <= 2048
    assert max(vision.size) <= 768
    assert loaded.gps is None


def test_parse_country_list_and_manifest(tmp_path: Path) -> None:
    assert parse_country_list("it, jp FR", 3) == ["IT", "JP", "FR"]
    with pytest.raises(QuizPhotoFileError):
        parse_country_list("IT,JP", 3)

    manifest = tmp_path / "countries.json"
    manifest.write_text(
        json.dumps({"IT-colosseum.jpg": "IT", "fuji.jpg": "jp"}),
        encoding="utf-8",
    )
    assert load_country_manifest(manifest) == {
        "IT-colosseum.jpg": "IT",
        "fuji.jpg": "JP",
    }

    csv_path = tmp_path / "countries.csv"
    csv_path.write_text("file,country_code\na.jpg,ES\nb.jpg,GR\n", encoding="utf-8")
    assert load_country_manifest(csv_path) == {"a.jpg": "ES", "b.jpg": "GR"}


def test_list_photo_paths_skips_sidecar(tmp_path: Path) -> None:
    _write_photos(tmp_path, ["b.jpg", "a.jpg"])
    (tmp_path / "readme.txt").write_text("nope")
    names = [path.name for path in list_photo_paths(tmp_path)]
    assert names == ["a.jpg", "b.jpg"]


# ---------------------------------------------------------------------------
# Country resolution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_countries_prefers_flag_over_filename(tmp_path: Path) -> None:
    _write_photos(
        tmp_path,
        ["IT-one.jpg", "JP-two.jpg", "FR-three.jpg", "ES-four.jpg", "GR-five.jpg"],
    )
    loaded = [load_quiz_photo(path) for path in list_photo_paths(tmp_path)]
    resolved = await resolve_photo_countries(
        loaded, countries="US,TH,MA,PE,PT", geocode=lambda *_: _never_geocode()
    )
    assert [photo.country_code for photo in resolved] == ["US", "TH", "MA", "PE", "PT"]
    assert {photo.country_source for photo in resolved} == {"flag"}


async def _never_geocode() -> str | None:
    raise AssertionError("geocode should not run when a flag/manifest/filename exists")


@pytest.mark.asyncio
async def test_resolve_countries_uses_filename_then_gps(tmp_path: Path) -> None:
    _write_photos(tmp_path, ["IT-one.jpg", "plain.jpg"])
    loaded = [load_quiz_photo(path) for path in list_photo_paths(tmp_path)]
    # Inject GPS on the plain photo without going through EXIF write.
    loaded[1] = type(loaded[1])(
        path=loaded[1].path,
        upload_jpeg=loaded[1].upload_jpeg,
        vision_jpeg=loaded[1].vision_jpeg,
        gps=(35.68, 139.76),
    )

    async def geocode(lat: float, lon: float) -> str | None:
        assert lat == pytest.approx(35.68)
        return "JP"

    resolved = await resolve_photo_countries(loaded, geocode=geocode)
    assert [(p.country_code, p.country_source) for p in resolved] == [
        ("IT", "filename"),
        ("JP", "gps"),
    ]


@pytest.mark.asyncio
async def test_resolve_countries_fails_when_nothing_supplies_iso(
    tmp_path: Path,
) -> None:
    _write_photos(tmp_path, ["plain.jpg"])
    loaded = [load_quiz_photo(path) for path in list_photo_paths(tmp_path)]

    async def no_geo(_lat: float, _lon: float) -> str | None:
        return None

    with pytest.raises(QuizFromPhotosError, match="No country for: plain.jpg"):
        await resolve_photo_countries(loaded, geocode=no_geo)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _five_names() -> list[str]:
    return ["IT-a.jpg", "JP-b.jpg", "FR-c.jpg", "ES-d.jpg", "GR-e.jpg"]


@pytest.mark.asyncio
async def test_create_quiz_reaches_awaiting_owner_play(tmp_path: Path) -> None:
    _write_photos(tmp_path, _five_names())
    db = FakeDB()
    uploaded: list[str] = []

    async def classify(images: list[str]) -> list[QuizImageOutcome]:
        assert len(images) == 5
        return [_eligible() for _ in images]

    async def upload(path: str, jpeg: bytes) -> None:
        assert path.startswith("quiz/")
        assert jpeg[:2] == b"\xff\xd8"
        uploaded.append(path)

    async def options(db_arg, corrects, **_kwargs):
        return [
            (["Italy", "France", "Spain", "Greece"], 0),
            (["Japan", "France", "Spain", "Greece"], 0),
            (["France", "Italy", "Spain", "Greece"], 0),
            (["Spain", "Italy", "France", "Greece"], 0),
            (["Greece", "Italy", "France", "Spain"], 0),
        ]

    with patch("app.services.quiz_from_photos.build_place_options", options):
        result = await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            db=db,
            classify=classify,
            upload=upload,
        )

    assert result.state == "awaiting_owner_play"
    assert result.question_count == 5
    assert result.owner_id == OWNER_ID
    assert "Play" in result.next_step
    assert "Share" in result.next_step
    assert OWNER_PLAY_NEXT_STEP in result.next_step
    assert db.quizzes[0]["state"] == "awaiting_owner_play"
    assert db.quizzes[0]["classified_count"] == 5
    assert len(db.questions) == 5
    assert [row["position"] for row in db.questions] == [0, 1, 2, 3, 4]
    assert len(uploaded) == 5
    assert all(row["options"] for row in db.questions)
    assert UUID(str(result.quiz_id))


@pytest.mark.asyncio
async def test_ineligible_photo_fails_closed_by_default(tmp_path: Path) -> None:
    _write_photos(tmp_path, _five_names())
    db = FakeDB()

    async def classify(images: list[str]) -> list[QuizImageOutcome]:
        outcomes = [_eligible() for _ in images]
        outcomes[0] = _ineligible("people")
        return outcomes

    with pytest.raises(QuizFromPhotosError, match="people_present"):
        await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            db=db,
            classify=classify,
            upload=lambda *_: _never_upload(),
        )
    assert db.quizzes == []


async def _never_upload() -> None:
    raise AssertionError("upload must not run when classification fails")


def _emerson_tiktok_names() -> list[str]:
    return [
        "cairo-mosque.jpg",
        "sainte-chapelle.jpg",
        "goreme-cave.jpg",
        "kotor.jpg",
        "penang-mural.jpg",
        "casco-viejo.jpg",
        "london.jpg",
        "vienna.jpg",
        "rome.jpg",
        "akihabara.jpg",
    ]


def _emerson_tiktok_countries() -> str:
    return "EG,FR,TR,ME,MY,PA,GB,AT,IT,JP"


def _emerson_tiktok_outcomes() -> list[QuizImageOutcome]:
    # Junk the owner might still --force keep: menus/screenshots and faces.
    # Indoor place stills now pass, so this fixture is category + people only.
    return [
        _ineligible("category"),
        _ineligible("category"),
        _ineligible("people"),
        _eligible(),
        _ineligible("category"),
        _ineligible("people"),
        _eligible(),
        _eligible(),
        _eligible(),
        _ineligible("people"),
    ]


@pytest.mark.asyncio
async def test_emerson_set_drop_ineligible_still_too_few(tmp_path: Path) -> None:
    _write_photos(tmp_path, _emerson_tiktok_names())
    db = FakeDB()

    async def classify(images: list[str]) -> list[QuizImageOutcome]:
        assert len(images) == 10
        return _emerson_tiktok_outcomes()

    with pytest.raises(QuizFromPhotosError, match="4 remain after classification"):
        await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            countries=_emerson_tiktok_countries(),
            drop_ineligible=True,
            db=db,
            classify=classify,
            upload=lambda *_: _never_upload(),
        )
    assert db.quizzes == []


def _emerson_tiktok_pass_outcomes() -> list[QuizImageOutcome]:
    indoor_place = QuizImageOutcome(
        result=QuizVisionResult(
            False, "indoor", "landmark", "urban",
        )
    )
    street = QuizImageOutcome(
        result=QuizVisionResult(
            False, "outdoor", "building_exterior", "urban",
        )
    )
    return [
        indoor_place,
        indoor_place,
        indoor_place,
        _eligible(),
        street,
        street,
        _eligible(),
        _eligible(),
        _eligible(),
        street,
    ]


@pytest.mark.asyncio
async def test_emerson_set_passes_without_force(tmp_path: Path) -> None:
    _write_photos(tmp_path, _emerson_tiktok_names())
    db = FakeDB()
    uploaded: list[str] = []

    async def classify(images: list[str]) -> list[QuizImageOutcome]:
        assert len(images) == 10
        return _emerson_tiktok_pass_outcomes()

    async def upload(path: str, jpeg: bytes) -> None:
        uploaded.append(path)

    async def options(db_arg, corrects, **_kwargs):
        four = ["Italy", "France", "Spain", "Greece"]
        return [(four, 0) for _ in corrects]

    with patch("app.services.quiz_from_photos.build_place_options", options):
        result = await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            countries=_emerson_tiktok_countries(),
            db=db,
            classify=classify,
            upload=upload,
        )

    assert result.state == "awaiting_owner_play"
    assert result.question_count == 10
    assert db.quizzes[0].get("slug") is None
    assert db.quizzes[0].get("score_to_beat_correct") is None
    assert len(uploaded) == 10


@pytest.mark.asyncio
async def test_force_keeps_owner_picked_ineligible_stills(tmp_path: Path) -> None:
    _write_photos(tmp_path, _emerson_tiktok_names())
    db = FakeDB()
    uploaded: list[str] = []
    classify_calls = 0

    async def classify(images: list[str]) -> list[QuizImageOutcome]:
        nonlocal classify_calls
        classify_calls += 1
        return _emerson_tiktok_outcomes()

    async def upload(path: str, jpeg: bytes) -> None:
        uploaded.append(path)

    async def options(db_arg, corrects, **_kwargs):
        four = ["Italy", "France", "Spain", "Greece"]
        return [(four, 0) for _ in corrects]

    with patch("app.services.quiz_from_photos.build_place_options", options):
        result = await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            countries=_emerson_tiktok_countries(),
            skip_eligibility=True,
            db=db,
            classify=classify,
            upload=upload,
        )

    assert classify_calls == 0
    assert result.state == "awaiting_owner_play"
    assert result.question_count == 10
    assert db.quizzes[0].get("score_to_beat_correct") is None
    assert db.quizzes[0].get("slug") is None
    assert db.quizzes[0]["state"] == "awaiting_owner_play"
    assert len(db.questions) == 10
    assert len(uploaded) == 10
    assert [photo.country_code for photo in result.photos] == [
        "EG",
        "FR",
        "TR",
        "ME",
        "MY",
        "PA",
        "GB",
        "AT",
        "IT",
        "JP",
    ]


@pytest.mark.asyncio
async def test_force_still_requires_country_ground_truth(tmp_path: Path) -> None:
    _write_photos(tmp_path, _five_names())
    db = FakeDB()
    # Strip filename tokens so force cannot invent a country.
    for path in list_photo_paths(tmp_path):
        path.rename(path.with_name(path.name.replace("-", "")))

    with pytest.raises(QuizFromPhotosError, match="No country for"):
        await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            skip_eligibility=True,
            db=db,
            classify=lambda images: _all_eligible(images),
            upload=lambda *_: _never_upload(),
        )
    assert db.quizzes == []


@pytest.mark.asyncio
async def test_drop_ineligible_keeps_enough_photos(tmp_path: Path) -> None:
    names = [*_five_names(), "IT-f.jpg"]
    _write_photos(tmp_path, names)
    db = FakeDB()

    async def classify(images: list[str]) -> list[QuizImageOutcome]:
        outcomes = [_eligible() for _ in images]
        outcomes[0] = _ineligible("category")
        return outcomes

    async def upload(path: str, jpeg: bytes) -> None:
        return None

    async def options(db_arg, corrects, **_kwargs):
        four = ["Italy", "France", "Spain", "Greece"]
        return [(four, 0) for _ in corrects]

    with patch("app.services.quiz_from_photos.build_place_options", options):
        result = await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            limit=6,
            drop_ineligible=True,
            db=db,
            classify=classify,
            upload=upload,
        )
    assert result.question_count == 5


@pytest.mark.asyncio
async def test_unknown_owner_does_not_create_a_draft(tmp_path: Path) -> None:
    _write_photos(tmp_path, _five_names())
    db = FakeDB()
    with pytest.raises(QuizFromPhotosError, match="No user_profile"):
        await create_quiz_from_photo_folder(
            owner_id="00000000-0000-0000-0000-000000000000",
            folder=tmp_path,
            db=db,
            classify=lambda images: _all_eligible(images),
            upload=lambda *_: _never_upload(),
        )
    assert db.quizzes == []


async def _all_eligible(images: list[str]) -> list[QuizImageOutcome]:
    return [_eligible() for _ in images]


@pytest.mark.asyncio
async def test_unknown_country_is_rejected_before_writes(tmp_path: Path) -> None:
    _write_photos(tmp_path, _five_names())
    db = FakeDB()
    with pytest.raises(QuizFromPhotosError, match="Unknown country"):
        await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            countries="ZZ,YY,XX,WW,VV",
            db=db,
            classify=lambda images: _all_eligible(images),
            upload=lambda *_: _never_upload(),
        )
    assert db.quizzes == []


@pytest.mark.asyncio
async def test_too_few_photos_declines(tmp_path: Path) -> None:
    _write_photos(tmp_path, ["IT-a.jpg", "JP-b.jpg", "FR-c.jpg"])
    with pytest.raises(QuizFromPhotosError, match="between 5 and 10"):
        await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            db=FakeDB(),
        )


@pytest.mark.asyncio
async def test_failed_finalize_deletes_the_draft(tmp_path: Path, monkeypatch) -> None:
    _write_photos(tmp_path, _five_names())
    db = FakeDB()

    async def explode(*_args, **_kwargs):
        raise RuntimeError("decoy boom")

    async def classify(images: list[str]) -> list[QuizImageOutcome]:
        return [_eligible() for _ in images]

    async def upload(path: str, jpeg: bytes) -> None:
        return None

    async def noop_sweep(_quiz_id) -> None:
        return None

    monkeypatch.setattr("app.services.quiz_from_photos.build_place_options", explode)
    monkeypatch.setattr(
        "app.services.quiz_from_photos.delete_quiz_storage_objects", noop_sweep
    )

    with pytest.raises(RuntimeError, match="decoy boom"):
        await create_quiz_from_photo_folder(
            owner_id=OWNER_ID,
            folder=tmp_path,
            db=db,
            classify=classify,
            upload=upload,
        )
    assert db.quizzes == []
    assert db.deleted_quiz_ids
