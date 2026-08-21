"""Pillow-rendered challenge card for Guess Where unfurls (R13).

The unfurl preview for /q/{slug} is a photo-rich 1200x630 PNG poster: one
challenge photo full-bleed under a midnight-navy scrim, with the owner's
challenge framing set on top in brand type. Carrying a real user photo here
is a DELIBERATE product decision (2026-08-17) that reversed the earlier
KTD11 rule ("share assets never carry user photos"). The accepted tradeoff:
messaging apps cache unfurl images on their own CDNs indefinitely, so a
photo baked into a card can outlive revocation of the quiz link no matter
what our Cache-Control says. Do not "fix" this back to a photo-free card --
photo-rich is the intent; revocation still 404s the route itself.

This module stays PURE and network-free: the photo arrives as optional bytes
fetched by the route. When no photo is available -- fetch failure, timeout,
undecodable bytes, a quiz with no questions -- rendering falls back to the
fully synthetic type-only card (field-guide paper, navy Playfair title, the
rotated adobe-brick stamp plate), so the card can never fail on imagery.

Brand fonts (Playfair Display 800, Open Sans 600/700 - both OFL) are
committed under app/static/fonts and loaded lazily once per (role, size);
any load failure falls back to Pillow's bundled default so this route can
never 500 on type.
"""

import hashlib
import io
import unicodedata
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

CARD_WIDTH = 1200
CARD_HEIGHT = 630

# Bump when the card design changes: the ETag is keyed on the rendered tuple
# plus this version, so a redesign invalidates cached validators.
# v3: the photo-rich poster (KTD11 reversed 2026-08-17).
_RENDER_VERSION = 3

# Longest display name the card will draw, in characters. Width fitting below
# clips further if the glyphs still overrun the layout.
_MAX_NAME_CHARS = 40

# Atlasi palette (see backend/app/static/css/src/variables.css).
_MIDNIGHT_NAVY = (23, 42, 58)
_WARM_CREAM = (253, 246, 237)
_SUNSET_GOLD = (255, 198, 54)
_ADOBE_BRICK = (193, 84, 62)
_MOSS_GREEN = (84, 122, 95)
_STORM_GRAY = (102, 109, 122)

_MARGIN = 96
_MAX_TEXT_WIDTH = CARD_WIDTH - 2 * _MARGIN

_ELLIPSIS = "…"

_FontT = ImageFont.FreeTypeFont | ImageFont.ImageFont

_FONTS_DIR = Path(__file__).resolve().parent.parent / "static" / "fonts"
_FONT_FILES = {
    "display": "PlayfairDisplay_800ExtraBold.ttf",
    "semibold": "OpenSans_600SemiBold.ttf",
    "bold": "OpenSans_700Bold.ttf",
}


@lru_cache(maxsize=16)
def _font(role: str, size: int) -> _FontT:
    """A committed brand face at `size`, loaded once per (role, size).

    Falls back to Pillow's bundled default on any failure -- ugly but
    unbreakable, which is the priority for a route that must never 500.
    """
    try:
        return ImageFont.truetype(str(_FONTS_DIR / _FONT_FILES[role]), size=size)
    except Exception:
        try:
            return ImageFont.load_default(size=size)
        except Exception:  # pragma: no cover - FreeType-less Pillow builds only
            return ImageFont.load_default()


def sanitize_display_name(name: str | None) -> str | None:
    """A display name reduced to something safe to hand to a rasterizer.

    Strips control characters (Cc: NUL, ESC, newlines) and format characters
    (Cf: bidi overrides like U+202E, zero-width joiners), collapses runs of
    whitespace, and truncates to `_MAX_NAME_CHARS`. RTL *letters* are kept --
    an Arabic or Hebrew name renders (naively shaped, without libraqm) rather
    than raising or vanishing; only the invisible direction-control characters
    are dropped.
    """
    if not name:
        return None
    cleaned = "".join(ch for ch in name if unicodedata.category(ch) not in ("Cc", "Cf"))
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return None
    if len(cleaned) > _MAX_NAME_CHARS:
        cleaned = cleaned[: _MAX_NAME_CHARS - 1].rstrip() + _ELLIPSIS
    return cleaned


def card_etag(
    quiz_id: str,
    owner_name: str | None,
    score_to_beat_correct: int | None,
    score_to_beat_total: int | None,
    question_count: int | None = None,
    photo_storage_path: str | None = None,
) -> str:
    """A strong ETag over the full rendered tuple.

    Everything that influences the card's pixels is in the key -- quiz id,
    owner name, score-to-beat, question count, and the chosen photo's
    storage path -- plus the render version so design changes bust cached
    validators. Nothing else (query params, time) may enter.
    """
    key = "\x1f".join(
        [
            str(_RENDER_VERSION),
            str(quiz_id),
            owner_name or "",
            str(score_to_beat_correct),
            str(score_to_beat_total),
            str(question_count),
            photo_storage_path or "",
        ]
    )
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return f'"{digest[:32]}"'


def _fit_text(
    draw: ImageDraw.ImageDraw, text: str, font: _FontT, max_width: int
) -> str:
    """`text` clipped (with an ellipsis) to render within `max_width` pixels."""
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + _ELLIPSIS, font=font) > max_width:
        text = text[:-1].rstrip()
    return text + _ELLIPSIS


def _draw_tracked(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: _FontT,
    fill: tuple[int, int, int],
    tracking: int = 5,
) -> None:
    """Uppercase eyebrow text with letterspacing (Pillow has no tracking)."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += int(draw.textlength(ch, font=font)) + tracking


def _tracked_width(
    draw: ImageDraw.ImageDraw, text: str, font: _FontT, tracking: int
) -> int:
    """The pixel width `_draw_tracked` will cover for `text`."""
    if not text:
        return 0
    return sum(int(draw.textlength(ch, font=font)) + tracking for ch in text) - tracking


def _fit_tracked(
    draw: ImageDraw.ImageDraw, text: str, font: _FontT, tracking: int, max_width: int
) -> str:
    """`text` clipped (with an ellipsis) to a tracked width of `max_width`."""
    if _tracked_width(draw, text, font, tracking) <= max_width:
        return text
    while text and _tracked_width(draw, text + _ELLIPSIS, font, tracking) > max_width:
        text = text[:-1].rstrip()
    return text + _ELLIPSIS


def _diamond(
    draw: ImageDraw.ImageDraw,
    center: tuple[int, int],
    radius: int,
    fill: tuple[int, int, int],
) -> None:
    """The brand's rotated-square mark (the web eyebrow's ::before)."""
    cx, cy = center
    draw.polygon(
        [(cx, cy - radius), (cx + radius, cy), (cx, cy + radius), (cx - radius, cy)],
        fill=fill,
    )


def _stamp_plate(
    label: str,
    value: str,
    rotation_deg: float = -3.0,
) -> Image.Image:
    """The score-to-beat as a rotated passport-stamp plate (RGBA layer)."""
    plate_w, plate_h = 400, 210
    layer = Image.new("RGBA", (plate_w, plate_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    draw.rounded_rectangle(
        [6, 6, plate_w - 6, plate_h - 6],
        radius=26,
        outline=(*_ADOBE_BRICK, 218),
        width=6,
    )

    label_font = _font("bold", 24)
    label_w = sum(int(draw.textlength(ch, font=label_font)) + 5 for ch in label) - 5
    _draw_tracked(
        draw,
        ((plate_w - max(label_w, 0)) // 2, 34),
        label,
        label_font,
        _ADOBE_BRICK,
        tracking=5,
    )

    value_font = _font("display", 104)
    value_w = int(draw.textlength(value, font=value_font))
    draw.text(((plate_w - value_w) // 2, 62), value, font=value_font, fill=_ADOBE_BRICK)

    return layer.rotate(rotation_deg, expand=True, resample=Image.Resampling.BICUBIC)


# Conservative pixel budget for the challenge photo. Uploads go direct to
# storage with no content validation, so a decompression-bomb image must
# degrade to the type-only card here instead of leaning on Pillow's far
# larger (~178M-px) default limit. Checked from the header before any pixel
# data is decoded.
_MAX_PHOTO_PIXELS = 40_000_000


def decode_card_photo(photo: bytes) -> Image.Image | None:
    """`photo` decoded, EXIF-upright, and cover-cropped to the canvas.

    Returns None on any failure -- undecodable bytes and over-pixel-budget
    dimensions must degrade to the type-only card, never raise.
    """
    try:
        with Image.open(io.BytesIO(photo)) as source:
            if source.width * source.height > _MAX_PHOTO_PIXELS:
                return None
            source.load()
            upright = ImageOps.exif_transpose(source)
        return ImageOps.fit(
            upright.convert("RGB"),
            (CARD_WIDTH, CARD_HEIGHT),
            Image.Resampling.LANCZOS,
        )
    except Exception:
        return None


def _apply_scrim(image: Image.Image) -> None:
    """The midnight-navy scrim gradient: photo showing through at the top,
    fully legible type ground at the bottom."""
    gradient = Image.new("L", (1, CARD_HEIGHT))
    for y in range(CARD_HEIGHT):
        alpha = 110 + int((y / (CARD_HEIGHT - 1)) * 125)
        gradient.putpixel((0, y), alpha)
    mask = gradient.resize((CARD_WIDTH, CARD_HEIGHT))
    overlay = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), _MIDNIGHT_NAVY)
    image.paste(overlay, (0, 0), mask)


def _render_photo_card(
    photo_image: Image.Image,
    name: str | None,
    score_to_beat_correct: int | None,
    score_to_beat_total: int | None,
    question_count: int | None,
    choice_count: int | None,
) -> bytes:
    """The photo-rich poster: full-bleed photo, scrim, challenge framing."""
    image = photo_image
    _apply_scrim(image)
    draw = ImageDraw.Draw(image)

    # Small tracked wordmark, top-left.
    _draw_tracked(
        draw, (_MARGIN, 64), "ATLASI", _font("bold", 30), _WARM_CREAM, tracking=10
    )

    # Eyebrow: {NAME}'S CHALLENGE, sunset gold, tracked uppercase.
    challenger = (name or "A friend").upper()
    eyebrow_font = _font("bold", 27)
    eyebrow = _fit_tracked(
        draw, f"{challenger}'S CHALLENGE", eyebrow_font, 6, _MAX_TEXT_WIDTH
    )
    _draw_tracked(draw, (_MARGIN, 336), eyebrow, eyebrow_font, _SUNSET_GOLD, tracking=6)

    # Playfair headline: the score to beat, or the mystery framing.
    if score_to_beat_correct is not None and score_to_beat_total is not None:
        headline = f"Can you beat {score_to_beat_correct} / {score_to_beat_total}?"
    else:
        headline = "Can you guess where?"
    title_font = _font("display", 92)
    headline = _fit_text(draw, headline, title_font, _MAX_TEXT_WIDTH)
    draw.text((_MARGIN, 380), headline, font=title_font, fill=_WARM_CREAM)

    # Support line: the real question count and choices per question.
    if question_count:
        photos_word = "photo" if question_count == 1 else "photos"
        support = f"{question_count} {photos_word}. {choice_count or 4} choices."
        draw.text((_MARGIN, 502), support, font=_font("semibold", 32), fill=_WARM_CREAM)

    # Gold CTA line.
    draw.text(
        (_MARGIN, 556), "Play the challenge", font=_font("bold", 30), fill=_SUNSET_GOLD
    )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_challenge_card(
    owner_name: str | None,
    score_to_beat_correct: int | None,
    score_to_beat_total: int | None,
    question_count: int | None = None,
    choice_count: int | None = None,
    photo: bytes | Image.Image | None = None,
) -> bytes:
    """The challenge-card PNG bytes for a shared quiz.

    With a `photo` (raw bytes, or an image the route already ran through
    `decode_card_photo` -- this function never touches the network) the card
    is the photo-rich poster: user photos on share assets are allowed by
    explicit decision (2026-08-17, reversing KTD11), accepting that unfurl
    CDNs cache them past revocation. Without a photo, or when the bytes do
    not decode, the render falls back to the fully synthetic type-only card
    so imagery can never take the route down. Deterministic for a given
    input tuple.
    """
    name = sanitize_display_name(owner_name)
    if photo is not None:
        photo_image = (
            photo if isinstance(photo, Image.Image) else decode_card_photo(photo)
        )
        if photo_image is not None:
            return _render_photo_card(
                photo_image,
                name,
                score_to_beat_correct,
                score_to_beat_total,
                question_count,
                choice_count,
            )
    return _render_type_only_card(name, score_to_beat_correct, score_to_beat_total)


def _render_type_only_card(
    name: str | None,
    score_to_beat_correct: int | None,
    score_to_beat_total: int | None,
) -> bytes:
    """The fully synthetic fallback card (the pre-reversal design).

    Background, type, and stamp motif only -- no photos, no network, no
    per-request filesystem reads beyond the cached font files.
    """
    image = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), _WARM_CREAM)
    draw = ImageDraw.Draw(image)

    # Eyebrow: gold mark + tracked uppercase, moss green.
    _diamond(draw, (_MARGIN + 10, 132), 10, _SUNSET_GOLD)
    _draw_tracked(
        draw,
        (_MARGIN + 34, 116),
        "A GUESS WHERE CHALLENGE",
        _font("bold", 28),
        _MOSS_GREEN,
        tracking=6,
    )

    # Challenge title, clipped to the layout width (the plate owns the right
    # side below, but the title may run the full measure).
    title_font = _font("display", 88)
    challenger = name or "A friend"
    title = _fit_text(draw, f"{challenger} challenges you", title_font, _MAX_TEXT_WIDTH)
    draw.text((_MARGIN, 176), title, font=title_font, fill=_MIDNIGHT_NAVY)

    # Subtitle sits left of the plate, so its measure stops at the plate edge.
    subtitle_font = _font("semibold", 34)
    subtitle = _fit_text(
        draw,
        "Where was each photo taken?",
        subtitle_font,
        CARD_WIDTH - 400 - 72 - _MARGIN - 36,
    )
    draw.text((_MARGIN, 330), subtitle, font=subtitle_font, fill=_STORM_GRAY)

    # The stamp plate: the seeded score, or the mystery mark for a challenge
    # whose owner has not set a score yet.
    if score_to_beat_correct is not None and score_to_beat_total is not None:
        plate = _stamp_plate(
            "THE SCORE TO BEAT", f"{score_to_beat_correct}/{score_to_beat_total}"
        )
    else:
        plate = _stamp_plate("CAN YOU GUESS", "?")
    image.paste(plate, (CARD_WIDTH - plate.width - 72, 316), plate)

    # Branding footer.
    _diamond(draw, (_MARGIN + 8, 536), 8, _SUNSET_GOLD)
    draw.text(
        (_MARGIN + 30, 500), "Atlasi", font=_font("display", 52), fill=_MIDNIGHT_NAVY
    )
    draw.text(
        (_MARGIN + 2, 572),
        "Track your travels. Challenge your friends.",
        font=_font("semibold", 26),
        fill=_STORM_GRAY,
    )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
