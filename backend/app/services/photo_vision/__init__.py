"""Photo vision classification service.

Classifies photos using Gemini Flash Lite via OpenRouter to improve
place matching accuracy. Returns category, detected text, and confidence.
"""

from .classifier import PhotoClassifier, VisionResult

__all__ = [
    "PhotoClassifier",
    "VisionResult",
]
