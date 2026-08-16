"""Pillow-rendered challenge card for Guess Where unfurls (R13).

The unfurl preview for /q/{slug} is a fully generated 1200x630 PNG carrying
only the challenge framing: owner display name, score-to-beat, and Atlasi
branding. It deliberately contains NO quiz photo (KTD11): messaging apps
cache unfurl images on their own CDNs indefinitely, so a real photo baked
into the card would outlive revocation no matter what our Cache-Control says.
A synthetic card leaks nothing a revoked link should take down.

Design: the brand's field-guide paper - warm cream ground, navy Playfair
title, uppercase moss eyebrow with the rotated gold mark, and the score to
beat pressed in as a rotated adobe-brick stamp plate (a "?" plate when no
score is seeded yet). Mirrors the public page and the in-app share card.

Rendering is fully local: no outbound fetches of any kind. Brand fonts
(Playfair Display 800, Open Sans 600/700 - both OFL) are committed under
app/static/fonts and loaded lazily once per (role, size); any load failure
falls back to Pillow's bundled default so this route can never 500 on type.
"""

import hashlib
import io
import unicodedata
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CARD_WIDTH = 1200
CARD_HEIGHT = 630

# Bump when the card design changes: the ETag is keyed on the rendered tuple
# plus this version, so a redesign invalidates cached validators.
_RENDER_VERSION = 2

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
) -> str:
    """A strong ETag over the full rendered tuple.

    Everything that influences the card's pixels is in the key -- quiz id,
    owner name, score-to-beat -- plus the render version so design changes
    bust cached validators. Nothing else (query params, time) may enter.
    """
    key = "\x1f".join(
        [
            str(_RENDER_VERSION),
            str(quiz_id),
            owner_name or "",
            str(score_to_beat_correct),
            str(score_to_beat_total),
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


def render_challenge_card(
    owner_name: str | None,
    score_to_beat_correct: int | None,
    score_to_beat_total: int | None,
) -> bytes:
    """The challenge-card PNG bytes for a shared quiz.

    Fully synthetic -- background, type, and stamp motif only; no photos, no
    network, no per-request filesystem reads beyond the cached font files.
    Deterministic for a given (owner name, score-to-beat) tuple.
    """
    name = sanitize_display_name(owner_name)

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
