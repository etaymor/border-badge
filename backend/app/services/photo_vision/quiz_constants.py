"""Constants for travel-photo-quiz eligibility classification.

Quiz-specific prompt and strict JSON response format, deliberately separate
from the tuned photo-import prompt/schema in ``constants.py`` (KTD3): the
import classifier is precision-tuned for place matching and must not change,
while the quiz gate answers a different question -- is this photo safe and
suitable to show publicly as a "guess where" puzzle?

Eligibility rule (R2, 2026-08-26): a photo is eligible when it is a place
still -- scenery, landmark, or building (exterior OR interior) -- and it
does not show a close-up identifiable face. Distant people, backs, crowds,
mosque interiors, chapels, cave hotels, and street murals on buildings
pass. Screenshots, maps, passports, stamps, UI, selfies with a clear face,
and food menus with readable text fail closed. "unclear" setting also
fails closed.

The people test is judged on identifiable-face prominence, not presence:
a street crowd or doorway figure is a good guess-where puzzle; a selfie
or portrait is not.
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

# "unclear" is a valid model answer but never passes the setting gate.
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
                        "True only for a clear close-up identifiable face: a "
                        "selfie, portrait, or someone facing the camera and "
                        "filling a large part of the frame. Distant crowds, "
                        "backs, doorway figures, and small street silhouettes "
                        "are false."
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

1. has_people: Answer true ONLY when there is a clear close-up identifiable face -- a selfie, a portrait, or someone facing the camera and filling a large part of the frame. Answer false for distant people, backs, doorway figures, small silhouettes, and crowds in a street or market (including an Akihabara crowd or figures in a Casco Viejo doorway). Judge identifiable-face prominence, not presence.

2. setting: Was the photo taken outdoors or indoors? Covered but open spaces count as OUTDOOR -- street markets, train platforms, arcades, colonnades, terraces, stadium stands. Fully enclosed interiors (mosque interiors, chapels, cave hotels) are indoor -- that is fine; indoor is allowed. Answer "unclear" if you cannot tell (extreme close-up, abstract shot, heavy editing).

3. category:
- scenery: natural landscapes -- mountains, beaches, lakes, forests, deserts, countryside, city skylines seen from afar
- landmark: a recognizable monument or famous site -- towers, temples, mosques, chapels, bridges, statues, ruins, palaces, cave churches or cave hotels
- building_exterior: buildings, streets, plazas, facades, architecture, AND interiors of buildings that show the place (mosque halls, chapel interiors, cave-hotel rooms), AND street murals painted on buildings
- other: junk that is not a place still -- screenshots, maps, passports, stamps, UI, food menus with readable text, receipts, documents, close-up food plates, objects with no location cue

4. landscape: the dominant scenery a traveler would confuse with another country. Indoor architecture is urban. Pick one:
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
    "Screen this travel photo: close-up identifiable face or not, "
    "indoor or outdoor, which category, and which landscape?"
)
