"""Aggregated city data from all regions.

This module combines city data from regional files for easy import.
To add new cities, edit the appropriate regional file:
- cities_europe.py
- cities_asia.py
- cities_middle_east.py
- cities_americas.py
- cities_africa.py
- cities_oceania.py
"""

from app.services.place_extractor.data.cities_africa import CITIES_AFRICA
from app.services.place_extractor.data.cities_americas import CITIES_AMERICAS
from app.services.place_extractor.data.cities_asia import CITIES_ASIA
from app.services.place_extractor.data.cities_europe import CITIES_EUROPE
from app.services.place_extractor.data.cities_middle_east import CITIES_MIDDLE_EAST
from app.services.place_extractor.data.cities_oceania import CITIES_OCEANIA

# Combine all regional city dictionaries
MAJOR_CITIES: dict[str, tuple[float, float, str]] = {
    **CITIES_EUROPE,
    **CITIES_ASIA,
    **CITIES_MIDDLE_EAST,
    **CITIES_AMERICAS,
    **CITIES_AFRICA,
    **CITIES_OCEANIA,
}
