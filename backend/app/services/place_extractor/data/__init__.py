"""Location data for place extraction.

This package contains city and country data organized by region for maintainability.
Data is structured as: {name: (latitude, longitude, country_code)}
"""

from app.services.place_extractor.data.cities import MAJOR_CITIES
from app.services.place_extractor.data.countries import COUNTRIES

__all__ = ["MAJOR_CITIES", "COUNTRIES"]
