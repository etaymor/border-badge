"""Load a folder of travel photos for Guess Where quiz creation.

This is the file-side half of the existing in-app create path: the mobile
client resizes library photos, strips EXIF on upload, and sends a client-
resolved ISO country code into finalize. A folder of unused photos has no
photo-cache GPS, so this module recovers ground truth from (in order) an
explicit country list, a sidecar manifest, a filename token, or EXIF GPS.

Image prep matches the mobile conventions:
- eligibility thumbnail: 768px max side JPEG
- quiz-owned upload: 2048px max side JPEG, EXIF stripped
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = 50_000_000

logger = logging.getLogger(__name__)

# Keep these aligned with the mobile create path
# (visionPhoto.ts VISION_MAX_DIMENSION, quizImagePrep.ts QUIZ_UPLOAD_*).
VISION_MAX_DIMENSION = 768
UPLOAD_MAX_DIMENSION = 2048
VISION_JPEG_QUALITY = 75
UPLOAD_JPEG_QUALITY = 80

SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}

# IT-colosseum.jpg, 01_JP.jpg, fuji-JP.jpg, IT.jpg
_FILENAME_CODE_RE = re.compile(
    r"^(?:(?P<lead>[A-Za-z]{2})(?:[-_ ].+)?|"
    r".+[-_ ](?P<trail>[A-Za-z]{2})|"
    r"\d+[-_ ](?P<indexed>[A-Za-z]{2})(?:[-_ ].+)?)$"
)

# Pillow GPS IFD tags (ExifTags.GPSTAGS).
_GPS_LAT_REF = 1
_GPS_LAT = 2
_GPS_LON_REF = 3
_GPS_LON = 4
_EXIF_GPS_INFO = 34853


class QuizPhotoFileError(ValueError):
    """A photo file cannot be used for quiz creation."""


@dataclass(frozen=True)
class LoadedQuizPhoto:
    """One on-disk photo, decoded and resized, country not yet chosen."""

    path: Path
    upload_jpeg: bytes
    vision_jpeg: bytes
    gps: tuple[float, float] | None


def list_photo_paths(folder: Path) -> list[Path]:
    """Image files in ``folder``, sorted by name. Non-images are ignored."""
    if not folder.is_dir():
        raise QuizPhotoFileError(f"Photo folder does not exist: {folder}")
    paths = [
        path
        for path in folder.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    ]
    paths.sort(key=lambda path: path.name.lower())
    if not paths:
        raise QuizPhotoFileError(
            f"No images found in {folder} "
            f"(supported: {', '.join(sorted(SUPPORTED_SUFFIXES))})"
        )
    return paths


def load_quiz_photo(path: Path) -> LoadedQuizPhoto:
    """Decode one image, keep GPS, and emit the two JPEG sizes the pipeline uses."""
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise QuizPhotoFileError(f"Could not read {path.name}: {exc}") from exc
    try:
        with Image.open(io.BytesIO(data)) as source:
            gps = gps_from_image(source)
            upright = ImageOps.exif_transpose(source)
            rgb = _as_rgb(upright)
            upload_jpeg = _encode_jpeg(rgb, UPLOAD_MAX_DIMENSION, UPLOAD_JPEG_QUALITY)
            vision_jpeg = _encode_jpeg(rgb, VISION_MAX_DIMENSION, VISION_JPEG_QUALITY)
    except QuizPhotoFileError:
        raise
    except Exception as exc:
        raise QuizPhotoFileError(f"Could not decode {path.name}: {exc}") from exc
    return LoadedQuizPhoto(
        path=path,
        upload_jpeg=upload_jpeg,
        vision_jpeg=vision_jpeg,
        gps=gps,
    )


def gps_from_image(image: Image.Image) -> tuple[float, float] | None:
    """Return (lat, lon) from EXIF GPS, or None when the photo has no fix."""
    try:
        exif = image.getexif()
    except Exception:
        return None
    if not exif:
        return None
    gps_ifd = exif.get_ifd(_EXIF_GPS_INFO) if hasattr(exif, "get_ifd") else None
    if not gps_ifd:
        raw = exif.get(_EXIF_GPS_INFO)
        gps_ifd = raw if isinstance(raw, dict) else None
    if not gps_ifd:
        return None
    return gps_from_exif_ifd(gps_ifd)


def gps_from_exif_ifd(gps_ifd: dict[int, object]) -> tuple[float, float] | None:
    """Convert a Pillow GPS IFD into decimal degrees."""
    try:
        lat = _dms_to_decimal(gps_ifd[_GPS_LAT], gps_ifd.get(_GPS_LAT_REF, "N"))
        lon = _dms_to_decimal(gps_ifd[_GPS_LON], gps_ifd.get(_GPS_LON_REF, "E"))
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    return (lat, lon)


def country_code_from_filename(name: str) -> str | None:
    """Pull a two-letter ISO token out of a filename, or None.

    Accepts ``IT.jpg``, ``IT-colosseum.jpg``, ``01_JP.jpg``, ``fuji-JP.jpg``.
    Does not accept ``IMG_1234.jpg`` (three-letter camera prefixes).
    """
    stem = Path(name).stem.strip()
    match = _FILENAME_CODE_RE.match(stem)
    if not match:
        return None
    raw = match.group("lead") or match.group("trail") or match.group("indexed")
    if raw is None:
        return None
    return raw.upper()


def load_country_manifest(path: Path) -> dict[str, str]:
    """Map basename → ISO country code from JSON or CSV."""
    suffix = path.suffix.lower()
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise QuizPhotoFileError(f"Could not read manifest {path}: {exc}") from exc
    if suffix == ".json":
        return _manifest_from_json(text, path)
    if suffix == ".csv":
        return _manifest_from_csv(text, path)
    raise QuizPhotoFileError(
        f"Manifest must be .json or .csv, got {path.suffix or 'no extension'}"
    )


def parse_country_list(raw: str, expected: int) -> list[str]:
    """Parse ``IT,JP,FR`` (or whitespace-separated) into ``expected`` ISO codes."""
    tokens = [part.strip().upper() for part in re.split(r"[,\s]+", raw) if part.strip()]
    if len(tokens) != expected:
        raise QuizPhotoFileError(
            f"--countries has {len(tokens)} code(s) but the folder yielded "
            f"{expected} photo(s)"
        )
    for token in tokens:
        if len(token) != 2 or not token.isalpha():
            raise QuizPhotoFileError(
                f"Country code {token!r} is not a two-letter ISO code"
            )
    return tokens


def _manifest_from_json(text: str, path: Path) -> dict[str, str]:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise QuizPhotoFileError(f"Invalid JSON manifest {path}: {exc}") from exc
    mapping: dict[str, str] = {}
    if isinstance(payload, dict):
        items = payload.items()
        for key, value in items:
            mapping[_basename(str(key))] = _require_code(str(value), str(key))
        return mapping
    if isinstance(payload, list):
        for row in payload:
            if not isinstance(row, dict):
                raise QuizPhotoFileError(
                    f"Manifest {path} list entries must be objects with file "
                    "and country_code"
                )
            filename = row.get("file") or row.get("filename") or row.get("name")
            code = row.get("country_code") or row.get("country") or row.get("code")
            if not filename or not code:
                raise QuizPhotoFileError(
                    f"Manifest {path} row missing file/country_code: {row!r}"
                )
            mapping[_basename(str(filename))] = _require_code(str(code), str(filename))
        return mapping
    raise QuizPhotoFileError(
        f"Manifest {path} must be an object or a list of {{file, country_code}}"
    )


def _manifest_from_csv(text: str, path: Path) -> dict[str, str]:
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise QuizPhotoFileError(f"Manifest {path} has no CSV header")
    fields = {name.strip().lower(): name for name in reader.fieldnames if name}
    file_key = next(
        (fields[name] for name in ("file", "filename", "name") if name in fields),
        None,
    )
    code_key = next(
        (
            fields[name]
            for name in ("country_code", "country", "code")
            if name in fields
        ),
        None,
    )
    if file_key is None or code_key is None:
        raise QuizPhotoFileError(f"Manifest {path} CSV needs file,country_code columns")
    mapping: dict[str, str] = {}
    for row in reader:
        filename = (row.get(file_key) or "").strip()
        code = (row.get(code_key) or "").strip()
        if not filename:
            continue
        mapping[_basename(filename)] = _require_code(code, filename)
    return mapping


def _basename(value: str) -> str:
    return Path(value).name


def _require_code(value: str, label: str) -> str:
    code = value.strip().upper()
    if len(code) != 2 or not code.isalpha():
        raise QuizPhotoFileError(
            f"Country code for {label!r} is not a two-letter ISO code: {value!r}"
        )
    return code


def _as_rgb(image: Image.Image) -> Image.Image:
    if image.mode == "RGB":
        return image
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        return background
    return image.convert("RGB")


def _encode_jpeg(image: Image.Image, max_side: int, quality: int) -> bytes:
    width, height = image.size
    if width <= 0 or height <= 0:
        raise QuizPhotoFileError("Image has empty dimensions")
    longest = max(width, height)
    if longest > max_side:
        scale = max_side / longest
        image = image.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            Image.Resampling.LANCZOS,
        )
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def _dms_to_decimal(dms: object, ref: object) -> float:
    values = tuple(_ratio_to_float(part) for part in dms)  # type: ignore[arg-type]
    if len(values) != 3:
        raise ValueError("GPS DMS must have three components")
    degrees, minutes, seconds = values
    decimal = degrees + minutes / 60.0 + seconds / 3600.0
    ref_text = str(ref).upper()
    if ref_text in {"S", "W"}:
        decimal = -decimal
    return decimal


def _ratio_to_float(value: object) -> float:
    numerator = getattr(value, "numerator", None)
    denominator = getattr(value, "denominator", None)
    if numerator is not None and denominator is not None:
        return float(numerator) / float(denominator or 1)
    if isinstance(value, tuple) and len(value) == 2:
        return float(value[0]) / float(value[1] or 1)
    return float(value)
