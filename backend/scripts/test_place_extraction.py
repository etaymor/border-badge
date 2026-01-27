#!/usr/bin/env python3
"""Test place extraction against specific Instagram URLs.

Usage:
    cd backend
    poetry run python scripts/test_place_extraction.py
"""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.schemas.social_ingest import SocialProvider
from app.services.oembed_adapters import fetch_oembed
from app.services.place_extractor.candidate_extraction import extract_place_candidates
from app.services.place_extractor.data import COUNTRIES
from app.services.place_extractor.extractor import (
    MAX_PARALLEL_CANDIDATES,
    _try_candidate,
)
from app.services.place_extractor.location_hints import extract_location_hints
from app.services.place_extractor.scoring import score_place_result

TEST_URLS = [
    # Temple of Poseidon - mentioned multiple times in caption
    ("Temple of Poseidon", "https://www.instagram.com/reel/DM7qu6BNxey/"),
    # Karnak temple - clearly stated
    ("Karnak Temple", "https://www.instagram.com/reel/DTAkue4jL-_/"),
    # "Location:" prefix pattern
    ("Hoysaleshwara Temple", "https://www.instagram.com/reel/DOGcCedgINF/"),
    # 📍 Saint Simon Monastery - pin emoji
    ("Saint Simon Monastery", "https://www.instagram.com/reel/DTpnvvSDTNo/"),
    # Oman + place name - should not suggest Sudan
    ("Wadi in Oman", "https://www.instagram.com/reel/DSMc3IyigIB/"),
]


async def test_url(expected: str, url: str) -> None:
    """Test place extraction for a single URL."""
    print(f"\n{'='*80}")
    print(f"EXPECTED: {expected}")
    print(f"URL: {url}")
    print("=" * 80)

    # Fetch oEmbed data
    oembed = await fetch_oembed(url, provider=SocialProvider.INSTAGRAM, use_cache=False)
    if not oembed:
        print("❌ Failed to fetch oEmbed data")
        return

    title = oembed.title
    print(f"\n📝 Title: {title[:200] if title else 'None'}...")

    # Extract candidates
    candidates = extract_place_candidates(title, None, oembed.author_name)
    print(f"\n🎯 Extracted candidates ({len(candidates)}):")
    for i, c in enumerate(candidates[:5]):
        print(f"   {i+1}. {c}")

    # Extract location hints
    combined_text = " ".join(filter(None, [title, None]))
    location_hints = extract_location_hints(combined_text)
    location_bias = location_hints[0] if location_hints else None
    print(
        f"\n📍 Location bias: {location_bias.name if location_bias else 'None'} ({location_bias.country_code if location_bias else 'None'})"
    )

    # Filter out country names
    filtered_candidates = [c for c in candidates if c.lower() not in COUNTRIES]
    top_candidates = filtered_candidates[:MAX_PARALLEL_CANDIDATES]

    print(f"\n🔍 Testing top {len(top_candidates)} candidates with API:")

    # Try each candidate and show scores
    results = []
    for i, cand in enumerate(top_candidates):
        result = await _try_candidate(cand, location_bias=location_bias)
        if result:
            score = score_place_result(result, location_bias, i)
            results.append((score, result, cand))
            country_match = (
                "✅"
                if (location_bias and result.country_code == location_bias.country_code)
                else "❌"
                if location_bias
                else "—"
            )
            print(
                f"   {i+1}. '{cand[:30]}' → {result.name} ({result.country_code}) score={score:.2f} {country_match}"
            )
        else:
            print(f"   {i+1}. '{cand[:30]}' → NO MATCH")

    if results:
        results.sort(key=lambda x: x[0], reverse=True)
        best_score, best_result, best_cand = results[0]
        print(
            f"\n🏆 WINNER: {best_result.name} ({best_result.country_code}) from candidate '{best_cand[:30]}'"
        )
        print(f"   Score: {best_score:.2f}, Confidence: {best_result.confidence:.2f}")

        if (
            expected.lower() in best_result.name.lower()
            or best_result.name.lower() in expected.lower()
        ):
            print("   ✅ CORRECT!")
        else:
            print(f"   ❌ WRONG - expected '{expected}'")
    else:
        print("\n❌ NO PLACE DETECTED")


async def main():
    print("Testing Place Extraction with Updated Patterns")
    print("=" * 80)

    for expected, url in TEST_URLS:
        await test_url(expected, url)

    print("\n" + "=" * 80)
    print("Done!")


if __name__ == "__main__":
    asyncio.run(main())
