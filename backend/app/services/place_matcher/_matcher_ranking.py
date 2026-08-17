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
from .utils import (
    haversine,
    name_match_strength,
    sanitize_address,
    sanitize_place_name,
)

# Vision scoring constants
VISION_HIGH_CONFIDENCE_BONUS = 1.5
VISION_MEDIUM_CONFIDENCE_BONUS = 0.75

# Bonus when a candidate's name STRONG-matches vision-detected signage text
# (same venue per name_match_strength). A readable business name in the user's
# own photo is near-conclusive evidence of the visited place, so this must
# outweigh the combined review/fame/rating advantage of a mega-famous neighbor
# (~8 points for a 400k-review landmark).
NAME_MATCH_BONUS = 9.0

# Bonus for a WEAK match — the detected name appears inside a longer, different
# name ("Batobus- Musée d'Orsay" when the signage read "Musée d'Orsay"). Being
# named after the venue is a mild proximity/relevance hint, never decisive: it
# must stay below the vision category bonus and a ~50m distance advantage.
# Lodging-typed candidates get NOTHING from a weak match unless the photo
# itself is of accommodation (vision "stay") — short-term rentals are
# systematically named after nearby landmarks, which is how a Paris import
# suggested "Gorgeous 3 Bedroom Flat at Eiffel Tower" for Eiffel Tower photos.
WEAK_NAME_MATCH_BONUS = 2.0


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

        name_candidates: list[str] = (
            vision_result.business_name_candidates if vision_result is not None else []
        )

        def _best_name_match_strength(raw_name: str) -> str:
            """Best match tier across all detected name candidates."""
            best = "none"
            for candidate in name_candidates:
                strength = name_match_strength(raw_name, candidate)
                if strength == "strong":
                    return "strong"
                if strength == "weak":
                    best = "weak"
            return best

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
                    "_name_match": _best_name_match_strength(raw_name),
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

        def _type_prior(x: dict) -> float:
            """Lodging demotion + landmark boost (U3). Positive = worse rank.

            The rating-blind wide pass ranks on distance and vision alone, so
            without a type prior zero-review Airbnbs win dense residential
            cells and museum micro-POIs beat the museum itself.
            """

            def _magnitude(name: str, default: float) -> float:
                value = getattr(self._settings, name, default)
                return float(value) if isinstance(value, int | float) else default

            prior = 0.0
            place_types = set(x["types"])

            if place_types & VISION_TO_PLACE_TYPES["stay"]:
                penalty = _magnitude("places_rank_lodging_penalty", 2.5)
                vision_category = (
                    vision_result.category if vision_result is not None else None
                )
                vision_usable = (
                    vision_result is not None
                    and vision_result.confidence != "low"
                    and vision_category in VISION_TO_PLACE_TYPES
                )
                if vision_category == "stay":
                    pass  # the photo IS accommodation — no demotion
                elif vision_usable:
                    prior += penalty
                else:
                    # No signal either way: demote softly so junk listings
                    # stop winning on distance but a real hotel stays close.
                    prior += penalty * 0.5

            if (
                vision_result is not None
                and vision_result.category == "landmark"
                and vision_result.confidence != "low"
                and place_types & VISION_TO_PLACE_TYPES["landmark"]
            ):
                boost = _magnitude("places_rank_landmark_boost", 1.5)
                prior -= boost if vision_result.confidence == "high" else boost / 2

            return prior

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
            name_match_weight = _weight("places_rank_name_match_weight")

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

            # Vision signage name-match bonus. Strong (same venue) dominates;
            # weak (containment) is a mild hint, zeroed for lodging unless the
            # photo itself is of accommodation — see WEAK_NAME_MATCH_BONUS.
            strength = x["_name_match"]
            if strength == "strong":
                name_match = NAME_MATCH_BONUS
            elif strength == "weak":
                is_lodging = bool(set(x["types"]) & VISION_TO_PLACE_TYPES["stay"])
                vision_is_stay = (
                    vision_result is not None and vision_result.category == "stay"
                )
                name_match = (
                    0.0 if is_lodging and not vision_is_stay else WEAK_NAME_MATCH_BONUS
                )
            else:
                name_match = 0.0
            name_match *= name_match_weight

            # Lower score = better rank
            return (
                distance_penalty
                - review_bonus
                - rating_bonus
                - fame
                - dwell_cat
                - vision
                - name_match
                + _type_prior(x)
            )

        ranked.sort(key=sort_key)

        # Remove internal fields before returning
        for r in ranked:
            del r["_rating_count"]
            del r["_rating"]
            del r["_primary_type"]
            del r["_name_match"]

        return ranked
