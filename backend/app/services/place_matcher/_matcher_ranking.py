"""Ranking logic for PlaceMatcher."""

import math

from app.services.photo_vision import VisionResult
from app.services.photo_vision.constants import VISION_TO_PLACE_TYPES

from .constants import (
    BAYESIAN_CONFIDENCE,
    BAYESIAN_PRIOR_MEAN,
    DWELL_BONUS_TIERS,
    FAME_FLOOR_REVIEWS,
    FAME_SCALE,
    TIME_HINT_TYPE_MATCHES,
    TYPE_TO_CATEGORY,
)
from .utils import haversine, sanitize_address, sanitize_place_name

# Vision scoring constants
VISION_HIGH_CONFIDENCE_BONUS = 1.5
VISION_MEDIUM_CONFIDENCE_BONUS = 0.75


class RankingMixin:
    """Ranking/scoring behaviors for PlaceMatcher."""

    @staticmethod
    def _bayesian_rating(rating: float, review_count: int) -> float:
        """Shrink raw rating toward global mean based on review count.

        Places with few reviews collapse toward 3.8 (average).
        Places with many reviews keep their actual rating.

        Examples:
          4.8 stars, 5 reviews   -> 3.89
          4.2 stars, 500 reviews  -> 4.16
          4.5 stars, 2000 reviews -> 4.48
        """
        if not rating or review_count == 0:
            return BAYESIAN_PRIOR_MEAN
        return (review_count * rating + BAYESIAN_CONFIDENCE * BAYESIAN_PRIOR_MEAN) / (
            review_count + BAYESIAN_CONFIDENCE
        )

    @staticmethod
    def _fame_bonus(review_count: int) -> float:
        """Continuous fame signal with diminishing returns.

        Returns: 0.0 for <50 reviews, ~0.5 for 500, ~1.0 for 5000
        """
        if review_count < FAME_FLOOR_REVIEWS:
            return 0.0
        return max(
            0,
            (math.log10(review_count) - math.log10(FAME_FLOOR_REVIEWS)) * FAME_SCALE,
        )

    @staticmethod
    def _dwell_category_bonus(
        dwell_minutes: float | None,
        place_types: list[str],
        time_hint: str | None,
    ) -> float:
        """Dwell-tiered time bonus with category matching.

        Dwell time is a stronger signal than time-of-day.
        Category matching adds a soft bonus, never a hard filter.
        """
        bonus = 0.0

        # Dwell-based bonus
        if dwell_minutes is not None:
            for min_m, max_m, tier_bonus in DWELL_BONUS_TIERS:
                if min_m <= dwell_minutes < max_m:
                    bonus = tier_bonus
                    break

        # Time hint category match bonus (soft)
        if time_hint and time_hint in TIME_HINT_TYPE_MATCHES:
            matching_types = TIME_HINT_TYPE_MATCHES[time_hint]
            if any(t in matching_types for t in place_types):
                bonus += 0.3

        return bonus

    def _rank_by_distance(
        self,
        places: list[dict],
        cluster: dict,
        time_hint: str | None = None,
        vision_result: VisionResult | None = None,
    ) -> list[dict]:
        """
        Rank places by enhanced scoring algorithm.

        Scoring: distance/20 - log10(reviews) - bayesian_rating_bonus
                 - fame - dwell_category_bonus - vision_bonus

        Args:
            places: Places from API response
            cluster: Cluster with centroid and time data
            time_hint: Optional time hint (food/attraction/nightlife/quick_stop)
            vision_result: Optional VisionResult from photo classification

        Returns:
            List of place suggestions sorted by score (lower = better)
        """
        ranked = []
        cluster_lat = cluster["centroid"]["latitude"]
        cluster_lng = cluster["centroid"]["longitude"]

        # Compute dwell minutes from cluster time range
        dwell_minutes: float | None = None
        start_time = cluster.get("start_time")
        end_time = cluster.get("end_time")
        if start_time and end_time:
            # Handle both datetime objects and ISO strings
            if isinstance(start_time, str):
                from datetime import datetime

                start_time = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
                end_time = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            dwell_minutes = (end_time - start_time).total_seconds() / 60

        for place in places:
            place_loc = place.get("location", {})
            place_lat = place_loc.get("latitude", 0)
            place_lng = place_loc.get("longitude", 0)

            distance_m = haversine(cluster_lat, cluster_lng, place_lat, place_lng)

            # Map type to category
            primary_type = place.get("primaryType", "point_of_interest")
            category = TYPE_TO_CATEGORY.get(primary_type, "place")

            # Quality signals
            rating_count = place.get("userRatingCount", 0) or 0
            rating = place.get("rating", 0) or 0
            place_types = place.get("types", [])

            # Defensive access for displayName with sanitization
            display_name = place.get("displayName", {})
            raw_name = display_name.get("text", "") or "Unknown Place"
            raw_address = place.get("formattedAddress", "")

            ranked.append(
                {
                    "place_id": place["id"],
                    "name": sanitize_place_name(raw_name),
                    "address": sanitize_address(raw_address),
                    "location": {
                        "latitude": place_lat,
                        "longitude": place_lng,
                    },
                    "category": category,
                    "distance_m": round(distance_m, 1),
                    "types": place_types,
                    "vision_category": (
                        vision_result.category if vision_result is not None else None
                    ),
                    "_rating_count": rating_count,
                    "_rating": rating,
                    "_primary_type": primary_type,
                }
            )

        def _vision_bonus(place_types: list[str]) -> float:
            """Score bonus based on vision category match.

            High confidence: 1.5 bonus for matching types
            Medium confidence: 0.75 bonus for matching types
            Low confidence or no vision: 0
            """
            if vision_result is None or vision_result.confidence == "low":
                return 0.0

            matching_types = VISION_TO_PLACE_TYPES.get(vision_result.category, set())
            if not matching_types:
                return 0.0

            has_match = any(t in matching_types for t in place_types)
            if not has_match:
                return 0.0

            if vision_result.confidence == "high":
                return VISION_HIGH_CONFIDENCE_BONUS
            return VISION_MEDIUM_CONFIDENCE_BONUS

        def sort_key(x: dict) -> float:
            distance_m = x["distance_m"]
            review_count = x["_rating_count"]
            r = x["_rating"]

            def _weight(name: str) -> float:
                value = getattr(self._settings, name, 1.0)
                return float(value) if isinstance(value, int | float) else 1.0

            distance_weight = _weight("places_rank_distance_weight")
            review_weight = _weight("places_rank_review_weight")
            rating_weight = _weight("places_rank_rating_weight")
            fame_weight = _weight("places_rank_fame_weight")
            dwell_weight = _weight("places_rank_dwell_weight")
            vision_weight = _weight("places_rank_vision_weight")

            # Distance penalty: 1 point per 20m bucket (unchanged)
            distance_penalty = (distance_m / 20.0) * distance_weight

            # Review bonus: log scale (unchanged)
            review_bonus = math.log10(max(review_count, 1) + 1) * review_weight

            # Rating bonus: Bayesian-adjusted
            adj_rating = self._bayesian_rating(r, review_count)
            rating_bonus = (
                max(0, (adj_rating - BAYESIAN_PRIOR_MEAN) * 0.75) * rating_weight
            )

            # Fame bonus: continuous log scale
            fame = self._fame_bonus(review_count) * fame_weight

            # Dwell-aware category bonus
            dwell_cat = (
                self._dwell_category_bonus(dwell_minutes, x["types"], time_hint)
                * dwell_weight
            )

            # Vision category bonus
            vision = _vision_bonus(x["types"]) * vision_weight

            # Lower score = better rank
            return (
                distance_penalty
                - review_bonus
                - rating_bonus
                - fame
                - dwell_cat
                - vision
            )

        ranked.sort(key=sort_key)

        # Remove internal fields before returning
        for r in ranked:
            del r["_rating_count"]
            del r["_rating"]
            del r["_primary_type"]

        return ranked
