"""Pillow-rendered challenge card for quiz unfurls (U9, R13).

The unfurl preview for /q/{slug} is a fully generated 1200x630 PNG carrying
only the challenge framing: owner display name, score-to-beat, and Atlasi
branding. It deliberately contains NO quiz photo (KTD11): messaging apps
cache unfurl images on their own CDNs indefinitely, so a real photo baked
into the card would outlive revocation no matter what our Cache-Control says.
A synthetic card leaks nothing a revoked link should take down.

Rendering is fully local: no outbound fetches of any kind. The font is
Pillow's bundled scalable default (Aileron Regular, an open-license face
shipped inside Pillow >= 10.1), loaded lazily once per size and cached, so
the render path needs no committed font file and no filesystem lookups
beyond Pillow's own package data.
"""

import hashlib
import io
import unicodedata
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

CARD_WIDTH = 1200
CARD_HEIGHT = 630

# Bump when the card design changes: the ETag is keyed on the rendered tuple
# plus this version, so a redesign invalidates cached validators.
_RENDER_VERSION = 1

# Longest display name the card will draw, in characters. Width fitting below
# clips further if the glyphs still overrun the layout.
_MAX_NAME_CHARS = 40

# Atlasi palette (see backend/app/static/css/src/variables.css).
_MIDNIGHT_NAVY = (23, 42, 58)
_WARM_CREAM = (253, 246, 237)
_SUNSET_GOLD = (255, 198, 54)
_LAKE_BLUE = (160, 205, 235)

_MARGIN = 96
_MAX_TEXT_WIDTH = CARD_WIDTH - 2 * _MARGIN

_ELLIPSIS = "…"

_FontT = ImageFont.FreeTypeFont | ImageFont.ImageFont


@lru_cache(maxsize=8)
def _font(size: int) -> _FontT:
    """Pillow's bundled scalable default face at `size`, loaded once per size.

    Falls back to the non-scalable bitmap default if Pillow was built without
    FreeType -- ugly but unbreakable, which is the priority for a route that
    must never 500 on a display name.
    """
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


def render_challenge_card(
    owner_name: str | None,
    score_to_beat_correct: int | None,
    score_to_beat_total: int | None,
) -> bytes:
    """The challenge-card PNG bytes for a shared quiz.

    Fully synthetic -- background, type, and accent bar only; no photos, no
    network, no per-request filesystem reads. Deterministic for a given
    (owner name, score-to-beat) tuple.
    """
    name = sanitize_display_name(owner_name)

    image = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), _MIDNIGHT_NAVY)
    draw = ImageDraw.Draw(image)

    # Gold accent bar down the left edge.
    draw.rectangle([0, 0, 14, CARD_HEIGHT], fill=_SUNSET_GOLD)

    # Eyebrow.
    draw.text(
        (_MARGIN, 118),
        "TRAVEL PHOTO QUIZ",
        font=_font(34),
        fill=_SUNSET_GOLD,
    )

    # Challenge title, clipped to the layout width.
    title_font = _font(72)
    challenger = name or "A friend"
    title = _fit_text(draw, f"{challenger} challenges you", title_font, _MAX_TEXT_WIDTH)
    draw.text((_MARGIN, 196), title, font=title_font, fill=_WARM_CREAM)

    # Subtitle / score-to-beat.
    subtitle_font = _font(44)
    if score_to_beat_correct is not None and score_to_beat_total is not None:
        subtitle = f"The score to beat: {score_to_beat_correct}/{score_to_beat_total}"
    else:
        subtitle = "Guess the country in every photo"
    subtitle = _fit_text(draw, subtitle, subtitle_font, _MAX_TEXT_WIDTH)
    draw.text((_MARGIN, 330), subtitle, font=subtitle_font, fill=_LAKE_BLUE)

    # Branding footer.
    draw.text((_MARGIN, 470), "Atlasi", font=_font(48), fill=_WARM_CREAM)
    draw.text(
        (_MARGIN, 534),
        "Track your travels. Challenge your friends.",
        font=_font(30),
        fill=_LAKE_BLUE,
    )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
