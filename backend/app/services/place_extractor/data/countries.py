"""Country data with coordinates for location biasing.

Format: {country_name: (latitude, longitude, country_code)}
All country names should be lowercase for case-insensitive matching.
Includes common aliases (e.g., "uk" for United Kingdom).
"""

# Popular travel destinations
COUNTRIES_POPULAR: dict[str, tuple[float, float, str]] = {
    "japan": (36.2048, 138.2529, "JP"),
    "france": (46.2276, 2.2137, "FR"),
    "italy": (41.8719, 12.5674, "IT"),
    "spain": (40.4637, -3.7492, "ES"),
    "germany": (51.1657, 10.4515, "DE"),
    "united kingdom": (55.3781, -3.4360, "GB"),
    "uk": (55.3781, -3.4360, "GB"),
    "england": (52.3555, -1.1743, "GB"),
    "greece": (39.0742, 21.8243, "GR"),
    "portugal": (39.3999, -8.2245, "PT"),
    "netherlands": (52.1326, 5.2913, "NL"),
    "thailand": (15.8700, 100.9925, "TH"),
    "vietnam": (14.0583, 108.2772, "VN"),
    "indonesia": (-0.7893, 113.9213, "ID"),
    "philippines": (12.8797, 121.7740, "PH"),
    "singapore": (1.3521, 103.8198, "SG"),
    "malaysia": (4.2105, 101.9758, "MY"),
    "south korea": (35.9078, 127.7669, "KR"),
    "korea": (35.9078, 127.7669, "KR"),
    "china": (35.8617, 104.1954, "CN"),
    "taiwan": (23.6978, 120.9605, "TW"),
    "india": (20.5937, 78.9629, "IN"),
    "australia": (-25.2744, 133.7751, "AU"),
    "new zealand": (-40.9006, 174.8860, "NZ"),
    "mexico": (23.6345, -102.5528, "MX"),
    "canada": (56.1304, -106.3468, "CA"),
    "brazil": (-14.2350, -51.9253, "BR"),
    "argentina": (-38.4161, -63.6167, "AR"),
    "peru": (-9.1900, -75.0152, "PE"),
    "colombia": (4.5709, -74.2973, "CO"),
    "chile": (-35.6751, -71.5430, "CL"),
    "morocco": (31.7917, -7.0926, "MA"),
    "egypt": (26.8206, 30.8025, "EG"),
    "south africa": (-30.5595, 22.9375, "ZA"),
    "kenya": (-0.0236, 37.9062, "KE"),
    "tanzania": (-6.3690, 34.8888, "TZ"),
    "united arab emirates": (23.4241, 53.8478, "AE"),
    "uae": (23.4241, 53.8478, "AE"),
    "dubai": (25.2048, 55.2708, "AE"),  # City but often used for country
    "qatar": (25.3548, 51.1839, "QA"),
    "turkey": (38.9637, 35.2433, "TR"),
    "israel": (31.0461, 34.8516, "IL"),
    "iceland": (64.9631, -19.0208, "IS"),
    "norway": (60.4720, 8.4689, "NO"),
    "sweden": (60.1282, 18.6435, "SE"),
    "denmark": (56.2639, 9.5018, "DK"),
    "finland": (61.9241, 25.7482, "FI"),
    "ireland": (53.1424, -7.6921, "IE"),
    "scotland": (56.4907, -4.2026, "GB"),
    "switzerland": (46.8182, 8.2275, "CH"),
    "austria": (47.5162, 14.5501, "AT"),
    "czech republic": (49.8175, 15.4730, "CZ"),
    "czechia": (49.8175, 15.4730, "CZ"),
    "poland": (51.9194, 19.1451, "PL"),
    "hungary": (47.1625, 19.5033, "HU"),
    "croatia": (45.1, 15.2, "HR"),
    "russia": (61.5240, 105.3188, "RU"),
    "costa rica": (9.7489, -83.7534, "CR"),
    "cuba": (21.5218, -77.7812, "CU"),
    "jamaica": (18.1096, -77.2975, "JM"),
    "bahamas": (25.0343, -77.3963, "BS"),
    "puerto rico": (18.2208, -66.5901, "PR"),
    "hawaii": (19.8968, -155.5828, "US"),  # State but often searched as destination
    "maldives": (3.2028, 73.2207, "MV"),
    "sri lanka": (7.8731, 80.7718, "LK"),
    "nepal": (28.3949, 84.1240, "NP"),
    "cambodia": (12.5657, 104.9910, "KH"),
    "laos": (19.8563, 102.4955, "LA"),
    "myanmar": (21.9162, 95.9560, "MM"),
    "burma": (21.9162, 95.9560, "MM"),
}

# Balkans
COUNTRIES_BALKANS: dict[str, tuple[float, float, str]] = {
    "albania": (41.1533, 20.1683, "AL"),
    "kosovo": (42.6026, 20.9030, "XK"),
    "north macedonia": (41.5124, 21.4535, "MK"),
    "macedonia": (41.5124, 21.4535, "MK"),
    "serbia": (44.0165, 21.0059, "RS"),
    "bosnia": (43.9159, 17.6791, "BA"),
    "bosnia and herzegovina": (43.9159, 17.6791, "BA"),
    "montenegro": (42.7087, 19.3744, "ME"),
    "slovenia": (46.1512, 14.9955, "SI"),
    "bulgaria": (42.7339, 25.4858, "BG"),
    "romania": (45.9432, 24.9668, "RO"),
    "moldova": (47.4116, 28.3699, "MD"),
    "ukraine": (48.3794, 31.1656, "UA"),
    "belarus": (53.7098, 27.9534, "BY"),
}

# Caucasus
COUNTRIES_CAUCASUS: dict[str, tuple[float, float, str]] = {
    "georgia": (42.3154, 43.3569, "GE"),
    "armenia": (40.0691, 45.0382, "AM"),
    "azerbaijan": (40.1431, 47.5769, "AZ"),
}

# Central Asia
COUNTRIES_CENTRAL_ASIA: dict[str, tuple[float, float, str]] = {
    "kazakhstan": (48.0196, 66.9237, "KZ"),
    "uzbekistan": (41.3775, 64.5853, "UZ"),
    "kyrgyzstan": (41.2044, 74.7661, "KG"),
    "tajikistan": (38.8610, 71.2761, "TJ"),
    "turkmenistan": (38.9697, 59.5563, "TM"),
    "mongolia": (46.8625, 103.8467, "MN"),
}

# Middle East
COUNTRIES_MIDDLE_EAST: dict[str, tuple[float, float, str]] = {
    "saudi arabia": (23.8859, 45.0792, "SA"),
    "oman": (21.4735, 55.9754, "OM"),
    "yemen": (15.5527, 48.5164, "YE"),
    "kuwait": (29.3117, 47.4818, "KW"),
    "bahrain": (26.0667, 50.5577, "BH"),
    "jordan": (30.5852, 36.2384, "JO"),
    "lebanon": (33.8547, 35.8623, "LB"),
    "syria": (34.8021, 38.9968, "SY"),
    "iraq": (33.2232, 43.6793, "IQ"),
    "iran": (32.4279, 53.6880, "IR"),
    "persia": (32.4279, 53.6880, "IR"),
    "palestine": (31.9522, 35.2332, "PS"),
}

# Africa
COUNTRIES_AFRICA: dict[str, tuple[float, float, str]] = {
    "algeria": (28.0339, 1.6596, "DZ"),
    "libya": (26.3351, 17.2283, "LY"),
    "sudan": (12.8628, 30.2176, "SD"),
    "tunisia": (33.8869, 9.5375, "TN"),
    "benin": (9.3077, 2.3158, "BJ"),
    "burkina faso": (12.2383, -1.5616, "BF"),
    "cape verde": (16.5388, -23.0418, "CV"),
    "ivory coast": (7.5400, -5.5471, "CI"),
    "cote d'ivoire": (7.5400, -5.5471, "CI"),
    "gambia": (13.4432, -15.3101, "GM"),
    "ghana": (7.9465, -1.0232, "GH"),
    "guinea": (9.9456, -9.6966, "GN"),
    "guinea-bissau": (11.8037, -15.1804, "GW"),
    "liberia": (6.4281, -9.4295, "LR"),
    "mali": (17.5707, -3.9962, "ML"),
    "mauritania": (21.0079, -10.9408, "MR"),
    "niger": (17.6078, 8.0817, "NE"),
    "nigeria": (9.0820, 8.6753, "NG"),
    "senegal": (14.4974, -14.4524, "SN"),
    "sierra leone": (8.4606, -11.7799, "SL"),
    "togo": (8.6195, 0.8248, "TG"),
    "cameroon": (7.3697, 12.3547, "CM"),
    "central african republic": (6.6111, 20.9394, "CF"),
    "chad": (15.4542, 18.7322, "TD"),
    "congo": (-0.2280, 15.8277, "CG"),
    "democratic republic of congo": (-4.0383, 21.7587, "CD"),
    "drc": (-4.0383, 21.7587, "CD"),
    "equatorial guinea": (1.6508, 10.2679, "GQ"),
    "gabon": (-0.8037, 11.6094, "GA"),
    "sao tome": (0.1864, 6.6131, "ST"),
    "burundi": (-3.3731, 29.9189, "BI"),
    "comoros": (-11.6455, 43.3333, "KM"),
    "djibouti": (11.8251, 42.5903, "DJ"),
    "eritrea": (15.1794, 39.7823, "ER"),
    "ethiopia": (9.1450, 40.4897, "ET"),
    "madagascar": (-18.7669, 46.8691, "MG"),
    "malawi": (-13.2543, 34.3015, "MW"),
    "mauritius": (-20.3484, 57.5522, "MU"),
    "mozambique": (-18.6657, 35.5296, "MZ"),
    "rwanda": (-1.9403, 29.8739, "RW"),
    "seychelles": (-4.6796, 55.4920, "SC"),
    "somalia": (5.1521, 46.1996, "SO"),
    "south sudan": (6.8770, 31.3070, "SS"),
    "uganda": (1.3733, 32.2903, "UG"),
    "zambia": (-13.1339, 27.8493, "ZM"),
    "zimbabwe": (-19.0154, 29.1549, "ZW"),
    "zanzibar": (-6.1659, 39.2026, "TZ"),
    "angola": (-11.2027, 17.8739, "AO"),
    "botswana": (-22.3285, 24.6849, "BW"),
    "lesotho": (-29.6100, 28.2336, "LS"),
    "namibia": (-22.9576, 18.4904, "NA"),
    "eswatini": (-26.5225, 31.4659, "SZ"),
    "swaziland": (-26.5225, 31.4659, "SZ"),
}

# Caribbean
COUNTRIES_CARIBBEAN: dict[str, tuple[float, float, str]] = {
    "antigua": (17.0608, -61.7964, "AG"),
    "barbados": (13.1939, -59.5432, "BB"),
    "dominica": (15.4150, -61.3710, "DM"),
    "dominican republic": (18.7357, -70.1627, "DO"),
    "grenada": (12.1165, -61.6790, "GD"),
    "haiti": (18.9712, -72.2852, "HT"),
    "saint lucia": (13.9094, -60.9789, "LC"),
    "st lucia": (13.9094, -60.9789, "LC"),
    "trinidad": (10.6918, -61.2225, "TT"),
    "trinidad and tobago": (10.6918, -61.2225, "TT"),
}

# Central America
COUNTRIES_CENTRAL_AMERICA: dict[str, tuple[float, float, str]] = {
    "belize": (17.1899, -88.4976, "BZ"),
    "el salvador": (13.7942, -88.8965, "SV"),
    "guatemala": (15.7835, -90.2308, "GT"),
    "honduras": (15.2000, -86.2419, "HN"),
    "nicaragua": (12.8654, -85.2072, "NI"),
    "panama": (8.5380, -80.7821, "PA"),
}

# South America
COUNTRIES_SOUTH_AMERICA: dict[str, tuple[float, float, str]] = {
    "bolivia": (-16.2902, -63.5887, "BO"),
    "ecuador": (-1.8312, -78.1834, "EC"),
    "guyana": (4.8604, -58.9302, "GY"),
    "paraguay": (-23.4425, -58.4438, "PY"),
    "suriname": (3.9193, -56.0278, "SR"),
    "uruguay": (-32.5228, -55.7658, "UY"),
    "venezuela": (6.4238, -66.5897, "VE"),
}

# Asia additions
COUNTRIES_ASIA: dict[str, tuple[float, float, str]] = {
    "bangladesh": (23.6850, 90.3563, "BD"),
    "bhutan": (27.5142, 90.4336, "BT"),
    "pakistan": (30.3753, 69.3451, "PK"),
    "afghanistan": (33.9391, 67.7100, "AF"),
    "brunei": (4.5353, 114.7277, "BN"),
    "timor-leste": (-8.8742, 125.7275, "TL"),
    "east timor": (-8.8742, 125.7275, "TL"),
}

# Europe additions
COUNTRIES_EUROPE: dict[str, tuple[float, float, str]] = {
    "andorra": (42.5063, 1.5218, "AD"),
    "liechtenstein": (47.1660, 9.5554, "LI"),
    "luxembourg": (49.8153, 6.1296, "LU"),
    "malta": (35.9375, 14.3754, "MT"),
    "monaco": (43.7384, 7.4246, "MC"),
    "san marino": (43.9424, 12.4578, "SM"),
    "vatican": (41.9029, 12.4534, "VA"),
    "cyprus": (35.1264, 33.4299, "CY"),
    "estonia": (58.5953, 25.0136, "EE"),
    "latvia": (56.8796, 24.6032, "LV"),
    "lithuania": (55.1694, 23.8813, "LT"),
    "belgium": (50.5039, 4.4699, "BE"),
    "slovakia": (48.6690, 19.6990, "SK"),
}

# Pacific
COUNTRIES_PACIFIC: dict[str, tuple[float, float, str]] = {
    "papua new guinea": (-6.3150, 143.9555, "PG"),
    "samoa": (-13.7590, -172.1046, "WS"),
    "tonga": (-21.1790, -175.1982, "TO"),
    "vanuatu": (-15.3767, 166.9592, "VU"),
    "solomon islands": (-9.6457, 160.1562, "SB"),
    "micronesia": (7.4256, 150.5508, "FM"),
    "palau": (7.5150, 134.5825, "PW"),
    "marshall islands": (7.1315, 171.1845, "MH"),
    "kiribati": (-3.3704, -168.7340, "KI"),
    "nauru": (-0.5228, 166.9315, "NR"),
    "tuvalu": (-7.1095, 179.1940, "TV"),
    "french polynesia": (-17.6797, -149.4068, "PF"),
    "tahiti": (-17.6509, -149.4260, "PF"),
    "new caledonia": (-20.9043, 165.6180, "NC"),
    "guam": (13.4443, 144.7937, "GU"),
}

# Combine all country dictionaries
COUNTRIES: dict[str, tuple[float, float, str]] = {
    **COUNTRIES_POPULAR,
    **COUNTRIES_BALKANS,
    **COUNTRIES_CAUCASUS,
    **COUNTRIES_CENTRAL_ASIA,
    **COUNTRIES_MIDDLE_EAST,
    **COUNTRIES_AFRICA,
    **COUNTRIES_CARIBBEAN,
    **COUNTRIES_CENTRAL_AMERICA,
    **COUNTRIES_SOUTH_AMERICA,
    **COUNTRIES_ASIA,
    **COUNTRIES_EUROPE,
    **COUNTRIES_PACIFIC,
}
