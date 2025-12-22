"""European cities with coordinates for location biasing.

Format: {city_name: (latitude, longitude, country_code)}
All city names should be lowercase for case-insensitive matching.
"""

CITIES_EUROPE: dict[str, tuple[float, float, str]] = {
    # Western Europe
    "london": (51.5074, -0.1278, "GB"),
    "paris": (48.8566, 2.3522, "FR"),
    "amsterdam": (52.3676, 4.9041, "NL"),
    "brussels": (50.8503, 4.3517, "BE"),
    "dublin": (53.3498, -6.2603, "IE"),
    "edinburgh": (55.9533, -3.1883, "GB"),
    "manchester": (53.4808, -2.2426, "GB"),
    # Germany & Austria
    "berlin": (52.5200, 13.4050, "DE"),
    "munich": (48.1351, 11.5820, "DE"),
    "vienna": (48.2082, 16.3738, "AT"),
    # Switzerland
    "zurich": (47.3769, 8.5417, "CH"),
    "geneva": (46.2044, 6.1432, "CH"),
    # Italy
    "rome": (41.9028, 12.4964, "IT"),
    "milan": (45.4642, 9.1900, "IT"),
    "florence": (43.7696, 11.2558, "IT"),
    "venice": (45.4408, 12.3155, "IT"),
    "naples": (40.8518, 14.2681, "IT"),
    # Spain & Portugal
    "barcelona": (41.3851, 2.1734, "ES"),
    "madrid": (40.4168, -3.7038, "ES"),
    "lisbon": (38.7223, -9.1393, "PT"),
    # Nordic
    "copenhagen": (55.6761, 12.5683, "DK"),
    "stockholm": (59.3293, 18.0686, "SE"),
    "oslo": (59.9139, 10.7522, "NO"),
    "helsinki": (60.1699, 24.9384, "FI"),
    # Eastern Europe
    "prague": (50.0755, 14.4378, "CZ"),
    "budapest": (47.4979, 19.0402, "HU"),
    "warsaw": (52.2297, 21.0122, "PL"),
    "krakow": (50.0647, 19.9450, "PL"),
    # Greece & Turkey
    "athens": (37.9838, 23.7275, "GR"),
    "istanbul": (41.0082, 28.9784, "TR"),
    # Russia
    "moscow": (55.7558, 37.6173, "RU"),
    # Balkans
    "tirana": (41.3275, 19.8187, "AL"),
    "pristina": (42.6629, 21.1655, "XK"),
    "skopje": (41.9973, 21.4280, "MK"),
    "belgrade": (44.7866, 20.4489, "RS"),
    "sarajevo": (43.8563, 18.4131, "BA"),
    "podgorica": (42.4304, 19.2594, "ME"),
    "zagreb": (45.8150, 15.9819, "HR"),
    "ljubljana": (46.0569, 14.5058, "SI"),
    "split": (43.5081, 16.4402, "HR"),
    "dubrovnik": (42.6507, 18.0944, "HR"),
    "kotor": (42.4247, 18.7712, "ME"),
    "ohrid": (41.1231, 20.8016, "MK"),
    "mostar": (43.3438, 17.8078, "BA"),
}
