"""Constants for travel-photo-quiz eligibility classification.

Quiz-specific prompt and strict JSON response format, deliberately separate
from the tuned photo-import prompt/schema in ``constants.py`` (KTD3): the
import classifier is precision-tuned for place matching and must not change,
while the quiz gate answers a different question -- is this photo safe and
suitable to show publicly as a "guess where" puzzle?

Eligibility rule (R2): a photo is eligible only when it has NO people, is
OUTDOOR, and falls in one of the three allowed categories below. Everything
else -- including "unclear" answers -- fails closed to ineligible.
"""

from app.core.quiz_landscape import QUIZ_LANDSCAPE_VALUES

# Categories the quiz accepts (R2). "other" exists in the schema so the model
# always has a truthful answer; it is never eligible.
QUIZ_ELIGIBLE_CATEGORIES: set[str] = {
    "scenery",
    "landmark",
    "building_exterior",
}

QUIZ_CATEGORY_VALUES: list[str] = [
    "scenery",
    "landmark",
    "building_exterior",
    "other",
]

# "unclear" is a valid model answer but never passes the outdoor gate.
QUIZ_SETTING_VALUES: list[str] = ["outdoor", "indoor", "unclear"]

# OpenRouter structured output schema for quiz eligibility (strict JSON,
# mirroring the shape of CLASSIFICATION_RESPONSE_FORMAT without sharing it).
QUIZ_ELIGIBILITY_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "quiz_photo_eligibility",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "has_people": {
                    "type": "boolean",
                    "description": (
                        "True if ANY person is visible: faces, bodies, "
                        "silhouettes, reflections, or partial body parts, "
                        "however small, blurred, or distant."
                    ),
                },
                "setting": {
                    "type": "string",
                    "enum": ["outdoor", "indoor", "unclear"],
                },
                "category": {
                    "type": "string",
                    "enum": [
                        "scenery",
                        "landmark",
                        "building_exterior",
                        "other",
                    ],
                },
                "landscape": {
                    "type": "string",
                    "enum": list(QUIZ_LANDSCAPE_VALUES),
                    "description": (
                        "Dominant outdoor scenery, used to pick lookalike "
                        "decoy countries. Streets and architecture are urban."
                    ),
                },
            },
            "required": ["has_people", "setting", "category", "landscape"],
            "additionalProperties": False,
        },
    },
}

QUIZ_ELIGIBILITY_SYSTEM_PROMPT = """You are screening travel photos for a "guess where this was taken" quiz. Answer four questions about the photo.

1. has_people: Are ANY people visible? Count faces, bodies, silhouettes, reflections, and partial body parts (hands, feet, shoulders), however small, blurred, or distant. When in doubt, answer true.

2. setting: Was the photo taken outdoors or indoors? Covered but open spaces (markets, train platforms, stadium stands) count as indoor. Answer "unclear" if you cannot tell (extreme close-up, abstract shot, heavy editing).

3. category:
- scenery: natural landscapes -- mountains, beaches, lakes, forests, deserts, countryside, city skylines seen from afar
- landmark: a recognizable monument or famous site -- towers, temples, bridges, statues, ruins, palaces
- building_exterior: the outside of buildings, streets, plazas, facades, architecture
- other: anything else -- food, interiors, objects, vehicles, animals, documents, screenshots, art close-ups

4. landscape: the dominant outdoor scenery a traveler would confuse with another country. Pick one:
- coastal: beaches, sea cliffs, harbors, ocean
- mediterranean: dry hills, chaparral, terracotta, olive country
- prairie: rolling grassland, steppe, open plains
- alpine: peaks, snow, mountain valleys
- desert: sand, canyons, arid scrub
- tropical: jungle, palms, rainforest, atolls
- temperate_forest: woods, lakes, green countryside
- urban: streets, plazas, architecture, city fabric
- other: none of the above, or you cannot tell

Answer strictly in the requested JSON format."""

QUIZ_ELIGIBILITY_USER_PROMPT = (
    "Screen this travel photo: any people visible, indoor or outdoor, "
    "which category, and which landscape?"
)
