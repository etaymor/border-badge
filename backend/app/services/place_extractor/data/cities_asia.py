"""Asian cities with coordinates for location biasing.

Format: {city_name: (latitude, longitude, country_code)}
All city names should be lowercase for case-insensitive matching.
"""

CITIES_ASIA: dict[str, tuple[float, float, str]] = {
    # Japan
    "tokyo": (35.6762, 139.6503, "JP"),
    "osaka": (34.6937, 135.5023, "JP"),
    "kyoto": (35.0116, 135.7681, "JP"),
    # South Korea
    "seoul": (37.5665, 126.9780, "KR"),
    "busan": (35.1796, 129.0756, "KR"),
    # China
    "beijing": (39.9042, 116.4074, "CN"),
    "shanghai": (31.2304, 121.4737, "CN"),
    "hong kong": (22.3193, 114.1694, "HK"),
    # Taiwan
    "taipei": (25.0330, 121.5654, "TW"),
    # Southeast Asia
    "singapore": (1.3521, 103.8198, "SG"),
    "bangkok": (13.7563, 100.5018, "TH"),
    "phuket": (7.8804, 98.3923, "TH"),
    "chiang mai": (18.7883, 98.9853, "TH"),
    "hanoi": (21.0278, 105.8342, "VN"),
    "ho chi minh": (10.8231, 106.6297, "VN"),
    "saigon": (10.8231, 106.6297, "VN"),
    "bali": (-8.3405, 115.0920, "ID"),
    "jakarta": (-6.2088, 106.8456, "ID"),
    "kuala lumpur": (3.1390, 101.6869, "MY"),
    "manila": (14.5995, 120.9842, "PH"),
    "siem reap": (13.3671, 103.8448, "KH"),
    "phnom penh": (11.5564, 104.9282, "KH"),
    "luang prabang": (19.8850, 102.1347, "LA"),
    "vientiane": (17.9757, 102.6331, "LA"),
    "yangon": (16.8661, 96.1951, "MM"),
    # South Asia
    "mumbai": (19.0760, 72.8777, "IN"),
    "delhi": (28.7041, 77.1025, "IN"),
    "new delhi": (28.6139, 77.2090, "IN"),
    "bangalore": (12.9716, 77.5946, "IN"),
    "kathmandu": (27.7172, 85.3240, "NP"),
    "colombo": (6.9271, 79.8612, "LK"),
    "male": (4.1755, 73.5093, "MV"),
    "dhaka": (23.8103, 90.4125, "BD"),
    "islamabad": (33.6844, 73.0479, "PK"),
    "karachi": (24.8607, 67.0011, "PK"),
    "lahore": (31.5204, 74.3587, "PK"),
    # Central Asia
    "astana": (51.1605, 71.4704, "KZ"),
    "almaty": (43.2220, 76.8512, "KZ"),
    "tashkent": (41.2995, 69.2401, "UZ"),
    "samarkand": (39.6542, 66.9597, "UZ"),
    "bishkek": (42.8746, 74.5698, "KG"),
    "dushanbe": (38.5598, 68.7740, "TJ"),
    "ashgabat": (37.9601, 58.3261, "TM"),
    # Mongolia & Russia Far East
    "ulaanbaatar": (47.8864, 106.9057, "MN"),
    "vladivostok": (43.1332, 131.9113, "RU"),
    # Caucasus
    "tbilisi": (41.7151, 44.8271, "GE"),
    "yerevan": (40.1872, 44.5152, "AM"),
    "baku": (40.4093, 49.8671, "AZ"),
    "batumi": (41.6168, 41.6367, "GE"),
}
