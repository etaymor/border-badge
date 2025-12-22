"""Oceanian cities with coordinates for location biasing.

Format: {city_name: (latitude, longitude, country_code)}
All city names should be lowercase for case-insensitive matching.
"""

CITIES_OCEANIA: dict[str, tuple[float, float, str]] = {
    # Australia
    "sydney": (-33.8688, 151.2093, "AU"),
    "melbourne": (-37.8136, 144.9631, "AU"),
    "brisbane": (-27.4698, 153.0251, "AU"),
    "perth": (-31.9505, 115.8605, "AU"),
    # New Zealand
    "auckland": (-36.8509, 174.7645, "NZ"),
    "queenstown": (-45.0312, 168.6626, "NZ"),
    # Pacific Islands
    "fiji": (-17.7134, 178.0650, "FJ"),
    "suva": (-18.1416, 178.4419, "FJ"),
    "port moresby": (-9.4438, 147.1803, "PG"),
    "noumea": (-22.2758, 166.4580, "NC"),
    "papeete": (-17.5516, -149.5585, "PF"),
    "apia": (-13.8507, -171.7514, "WS"),
    "nuku'alofa": (-21.1393, -175.2018, "TO"),
    "port vila": (-17.7334, 168.3220, "VU"),
}
