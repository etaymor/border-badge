"""African cities with coordinates for location biasing.

Format: {city_name: (latitude, longitude, country_code)}
All city names should be lowercase for case-insensitive matching.
"""

CITIES_AFRICA: dict[str, tuple[float, float, str]] = {
    # North Africa
    "cairo": (30.0444, 31.2357, "EG"),
    "marrakech": (31.6295, -7.9811, "MA"),
    "casablanca": (33.5731, -7.5898, "MA"),
    "tunis": (36.8065, 10.1815, "TN"),
    "algiers": (36.7538, 3.0588, "DZ"),
    "tripoli": (32.8872, 13.1913, "LY"),
    "khartoum": (15.5007, 32.5599, "SD"),
    # East Africa
    "nairobi": (-1.2921, 36.8219, "KE"),
    "addis ababa": (9.0320, 38.7612, "ET"),
    "dar es salaam": (6.7924, 39.2083, "TZ"),
    "zanzibar city": (-6.1659, 39.2026, "TZ"),
    "kampala": (-0.3476, 32.5825, "UG"),
    "kigali": (-1.9403, 29.8739, "RW"),
    # Southern Africa
    "cape town": (-33.9249, 18.4241, "ZA"),
    "johannesburg": (-26.2041, 28.0473, "ZA"),
    "cape winelands": (-33.9180, 18.8602, "ZA"),
    "victoria falls": (-17.9243, 25.8572, "ZW"),
    "lusaka": (-15.3875, 28.3228, "ZM"),
    "harare": (-17.8252, 31.0335, "ZW"),
    "windhoek": (-22.5609, 17.0658, "NA"),
    "gaborone": (-24.6282, 25.9231, "BW"),
    "maputo": (-25.9692, 32.5732, "MZ"),
    "antananarivo": (-18.8792, 47.5079, "MG"),
    # West Africa
    "lagos": (6.5244, 3.3792, "NG"),
    "accra": (5.6037, -0.1870, "GH"),
    "dakar": (14.7167, -17.4677, "SN"),
    "abidjan": (5.3600, -4.0083, "CI"),
    # Central Africa
    "kinshasa": (-4.4419, 15.2663, "CD"),
    "luanda": (-8.8390, 13.2894, "AO"),
}
