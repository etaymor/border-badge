"""Middle Eastern cities with coordinates for location biasing.

Format: {city_name: (latitude, longitude, country_code)}
All city names should be lowercase for case-insensitive matching.
"""

CITIES_MIDDLE_EAST: dict[str, tuple[float, float, str]] = {
    # UAE
    "dubai": (25.2048, 55.2708, "AE"),
    "abu dhabi": (24.4539, 54.3773, "AE"),
    # Israel
    "tel aviv": (32.0853, 34.7818, "IL"),
    "jerusalem": (31.7683, 35.2137, "IL"),
    # Qatar
    "doha": (25.2854, 51.5310, "QA"),
    # Saudi Arabia
    "riyadh": (24.7136, 46.6753, "SA"),
    "jeddah": (21.5433, 39.1728, "SA"),
    # Oman
    "muscat": (23.5880, 58.3829, "OM"),
    # Kuwait
    "kuwait city": (29.3759, 47.9774, "KW"),
    # Bahrain
    "manama": (26.2285, 50.5860, "BH"),
    # Jordan
    "amman": (31.9454, 35.9284, "JO"),
    "petra": (30.3285, 35.4444, "JO"),
    # Lebanon
    "beirut": (33.8938, 35.5018, "LB"),
    # Syria
    "damascus": (33.5138, 36.2765, "SY"),
    # Iran
    "tehran": (35.6892, 51.3890, "IR"),
    "isfahan": (32.6546, 51.6680, "IR"),
}
