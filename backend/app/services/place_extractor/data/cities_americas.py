"""American cities with coordinates for location biasing.

Format: {city_name: (latitude, longitude, country_code)}
All city names should be lowercase for case-insensitive matching.
"""

CITIES_AMERICAS: dict[str, tuple[float, float, str]] = {
    # USA - Major Cities
    "new york": (40.7128, -74.0060, "US"),
    "nyc": (40.7128, -74.0060, "US"),
    "los angeles": (34.0522, -118.2437, "US"),
    "la": (34.0522, -118.2437, "US"),
    "san francisco": (37.7749, -122.4194, "US"),
    "sf": (37.7749, -122.4194, "US"),
    "chicago": (41.8781, -87.6298, "US"),
    "miami": (25.7617, -80.1918, "US"),
    "las vegas": (36.1699, -115.1398, "US"),
    "seattle": (47.6062, -122.3321, "US"),
    "boston": (42.3601, -71.0589, "US"),
    "austin": (30.2672, -97.7431, "US"),
    "denver": (39.7392, -104.9903, "US"),
    "nashville": (36.1627, -86.7816, "US"),
    "new orleans": (29.9511, -90.0715, "US"),
    "portland": (45.5152, -122.6784, "US"),
    "san diego": (32.7157, -117.1611, "US"),
    "honolulu": (21.3069, -157.8583, "US"),
    # Canada
    "toronto": (43.6532, -79.3832, "CA"),
    "vancouver": (49.2827, -123.1207, "CA"),
    "montreal": (45.5017, -73.5673, "CA"),
    # Mexico
    "mexico city": (19.4326, -99.1332, "MX"),
    "cancun": (21.1619, -86.8515, "MX"),
    # Central America
    "guatemala city": (14.6349, -90.5069, "GT"),
    "san salvador": (13.6929, -89.2182, "SV"),
    "tegucigalpa": (14.0723, -87.1921, "HN"),
    "managua": (12.1149, -86.2362, "NI"),
    "san jose": (9.9281, -84.0907, "CR"),
    "panama city": (8.9824, -79.5199, "PA"),
    "belize city": (17.4986, -88.1886, "BZ"),
    # South America
    "buenos aires": (-34.6037, -58.3816, "AR"),
    "rio de janeiro": (-22.9068, -43.1729, "BR"),
    "sao paulo": (-23.5505, -46.6333, "BR"),
    "lima": (-12.0464, -77.0428, "PE"),
    "cusco": (-13.5320, -71.9675, "PE"),
    "machu picchu": (-13.1631, -72.5450, "PE"),
    "bogota": (4.7110, -74.0721, "CO"),
    "medellin": (6.2476, -75.5658, "CO"),
    "cartagena": (10.3910, -75.4794, "CO"),
    "santiago": (-33.4489, -70.6693, "CL"),
    "quito": (-0.1807, -78.4678, "EC"),
    "guayaquil": (-2.1894, -79.8891, "EC"),
    "la paz": (-16.4897, -68.1193, "BO"),
    "sucre": (-19.0196, -65.2619, "BO"),
    "asuncion": (-25.2637, -57.5759, "PY"),
    "montevideo": (-34.9011, -56.1645, "UY"),
    "caracas": (10.4806, -66.9036, "VE"),
    # Caribbean
    "havana": (23.1136, -82.3666, "CU"),
    "san juan": (18.4655, -66.1057, "PR"),
    "nassau": (25.0480, -77.3554, "BS"),
    "kingston": (18.0179, -76.8099, "JM"),
    "bridgetown": (13.0969, -59.6145, "BB"),
    "port of spain": (10.6596, -61.5086, "TT"),
    "santo domingo": (18.4861, -69.9312, "DO"),
    "punta cana": (18.5601, -68.3725, "DO"),
    "montego bay": (18.4762, -77.8939, "JM"),
    "aruba": (12.5211, -69.9683, "AW"),
    "curacao": (12.1696, -68.9900, "CW"),
    "st maarten": (18.0425, -63.0548, "SX"),
}
