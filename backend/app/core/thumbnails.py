"""Thumbnail generation utilities."""

import io
import logging

# Register HEIF/HEIC support with Pillow
import pillow_heif
from PIL import Image

pillow_heif.register_heif_opener()

logger = logging.getLogger(__name__)

# Thumbnail configuration
THUMBNAIL_MAX_DIMENSION = 800  # pixels (longest edge)
THUMBNAIL_QUALITY = 85
THUMBNAIL_FORMAT = "JPEG"

# Supported input formats for thumbnail generation
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}


def generate_thumbnail(image_data: bytes, original_extension: str) -> bytes | None:
    """Generate a JPEG thumbnail from image data.

    Args:
        image_data: Raw bytes of the original image
        original_extension: File extension (e.g., ".heic", ".jpg")

    Returns:
        JPEG thumbnail bytes, or None if generation failed
    """
    ext = original_extension.lower()
    if not ext.startswith("."):
        ext = f".{ext}"

    if ext not in SUPPORTED_EXTENSIONS:
        logger.debug(f"Unsupported format for thumbnail: {ext}")
        return None

    try:
        # Open image (pillow-heif handles HEIC automatically)
        image = Image.open(io.BytesIO(image_data))

        # Convert to RGB if necessary (HEIC may use P3, PNG may have alpha)
        if image.mode in ("RGBA", "LA", "P"):
            # Create white background for transparent images
            background = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            if image.mode in ("RGBA", "LA"):
                # Paste with alpha mask
                background.paste(
                    image, mask=image.split()[-1] if image.mode == "RGBA" else None
                )
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")

        # Calculate thumbnail size maintaining aspect ratio
        original_width, original_height = image.size
        if original_width > original_height:
            if original_width > THUMBNAIL_MAX_DIMENSION:
                ratio = THUMBNAIL_MAX_DIMENSION / original_width
                new_size = (THUMBNAIL_MAX_DIMENSION, int(original_height * ratio))
            else:
                new_size = (original_width, original_height)
        else:
            if original_height > THUMBNAIL_MAX_DIMENSION:
                ratio = THUMBNAIL_MAX_DIMENSION / original_height
                new_size = (int(original_width * ratio), THUMBNAIL_MAX_DIMENSION)
            else:
                new_size = (original_width, original_height)

        # Resize using high-quality LANCZOS resampling
        if new_size != image.size:
            image = image.resize(new_size, Image.Resampling.LANCZOS)

        # Save to bytes buffer (EXIF is not copied by default in Pillow save)
        buffer = io.BytesIO()
        image.save(
            buffer, format=THUMBNAIL_FORMAT, quality=THUMBNAIL_QUALITY, optimize=True
        )
        buffer.seek(0)

        return buffer.read()

    except Exception as e:
        logger.error(f"Thumbnail generation failed: {e}", exc_info=True)
        return None


def get_thumbnail_path(original_path: str) -> str:
    """Generate thumbnail path from original file path.

    Args:
        original_path: e.g., "user-id/file-id.heic"

    Returns:
        Thumbnail path: e.g., "user-id/file-id_thumb.jpg"
    """
    # Remove extension and add _thumb.jpg
    if "." in original_path:
        base = original_path.rsplit(".", 1)[0]
    else:
        base = original_path
    return f"{base}_thumb.jpg"
