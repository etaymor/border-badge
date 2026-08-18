"""Test user personas with trips and entries."""

from datetime import date

TEST_PASSWORD = "TestUser123!"

PERSONAS = [
    {
        "username": "alex_chen",
        "home_country_code": "US",
        "travel_motives": ["Adventure", "Culture", "Budget"],
        "persona_tags": ["Explorer", "Solo Traveler"],
        "trips": [
            {
                "name": "Southeast Asia Backpacking",
                "country_code": "TH",
                "date_start": date(2024, 2, 1),
                "date_end": date(2024, 2, 28),
                "entries": [
                    {
                        "type": "place",
                        "title": "Grand Palace Bangkok",
                        "notes": "Stunning temple complex.",
                    },
                    {
                        "type": "food",
                        "title": "Best Pad Thai Ever",
                        "notes": "Street food near Khao San.",
                    },
                    {
                        "type": "stay",
                        "title": "Lub d Hostel Silom",
                        "notes": "Great social hostel.",
                    },
                ],
            },
            {
                "name": "South America Adventure",
                "country_code": "PE",
                "date_start": date(2024, 5, 10),
                "date_end": date(2024, 5, 25),
                "entries": [
                    {
                        "type": "place",
                        "title": "Machu Picchu at Sunrise",
                        "notes": "Worth the hike.",
                    },
                    {
                        "type": "food",
                        "title": "Ceviche in Lima",
                        "notes": "Fresh and tangy.",
                    },
                ],
            },
        ],
    },
    {
        "username": "sofia_travels",
        "home_country_code": "ES",
        "travel_motives": ["Relaxation", "Food", "Photography"],
        "persona_tags": ["Luxury Seeker", "Foodie"],
        "trips": [
            {
                "name": "Maldives Luxury Escape",
                "country_code": "MV",
                "date_start": date(2024, 3, 15),
                "date_end": date(2024, 3, 22),
                "entries": [
                    {
                        "type": "stay",
                        "title": "Overwater Villa",
                        "notes": "Turquoise waters everywhere.",
                    },
                    {
                        "type": "experience",
                        "title": "Sunset Dolphin Cruise",
                        "notes": "Magical.",
                    },
                ],
            },
            {
                "name": "Italian Food Journey",
                "country_code": "IT",
                "date_start": date(2024, 6, 5),
                "date_end": date(2024, 6, 15),
                "entries": [
                    {
                        "type": "place",
                        "title": "Colosseum at Golden Hour",
                        "notes": "Ancient Rome vibes.",
                    },
                    {
                        "type": "food",
                        "title": "Carbonara in Trastevere",
                        "notes": "No cream, perfection.",
                    },
                    {
                        "type": "food",
                        "title": "Gelato Tour of Florence",
                        "notes": "Pistachio won.",
                    },
                ],
            },
        ],
    },
    {
        "username": "yuki_adventures",
        "home_country_code": "JP",
        "travel_motives": ["Photography", "Nature", "Culture"],
        "persona_tags": ["Photographer", "Nature Lover"],
        "trips": [
            {
                "name": "Iceland Photography Expedition",
                "country_code": "IS",
                "date_start": date(2024, 1, 10),
                "date_end": date(2024, 1, 20),
                "entries": [
                    {
                        "type": "experience",
                        "title": "Northern Lights Hunt",
                        "notes": "Green and purple aurora!",
                    },
                    {
                        "type": "place",
                        "title": "Diamond Beach Sunrise",
                        "notes": "Ice glittering like diamonds.",
                    },
                ],
            },
        ],
    },
    {
        "username": "marcus_j",
        "home_country_code": "GB",
        "travel_motives": ["Food", "Culture", "Nightlife"],
        "persona_tags": ["Foodie", "Culture Buff"],
        "trips": [
            {
                "name": "Tokyo Food Odyssey",
                "country_code": "JP",
                "date_start": date(2024, 4, 20),
                "date_end": date(2024, 5, 1),
                "entries": [
                    {
                        "type": "food",
                        "title": "Tsukiji Outer Market",
                        "notes": "Fresh sushi for breakfast.",
                    },
                    {
                        "type": "food",
                        "title": "Michelin Ramen",
                        "notes": "Worth the 2 hour queue.",
                    },
                    {
                        "type": "experience",
                        "title": "Golden Gai Bar Hopping",
                        "notes": "Tiny bars, big character.",
                    },
                ],
            },
        ],
    },
    {
        "username": "priya_world",
        "home_country_code": "IN",
        "travel_motives": ["Culture", "History", "Spirituality"],
        "persona_tags": ["Culture Buff", "History Buff"],
        "trips": [
            {
                "name": "Egypt Historical Tour",
                "country_code": "EG",
                "date_start": date(2024, 2, 15),
                "date_end": date(2024, 2, 25),
                "entries": [
                    {
                        "type": "place",
                        "title": "Pyramids of Giza",
                        "notes": "The last ancient wonder.",
                    },
                    {
                        "type": "place",
                        "title": "Valley of the Kings",
                        "notes": "Tutankhamun's tomb!",
                    },
                ],
            },
            {
                "name": "Greek Islands Culture Trip",
                "country_code": "GR",
                "date_start": date(2024, 5, 20),
                "date_end": date(2024, 6, 2),
                "entries": [
                    {
                        "type": "place",
                        "title": "Acropolis at Dawn",
                        "notes": "Parthenon in golden light.",
                    },
                    {
                        "type": "place",
                        "title": "Santorini Blue Domes",
                        "notes": "That iconic view.",
                    },
                ],
            },
        ],
    },
    {
        "username": "lars_nordic",
        "home_country_code": "SE",
        "travel_motives": ["Adventure", "Nature", "Hiking"],
        "persona_tags": ["Outdoors Enthusiast", "Minimalist"],
        "trips": [
            {
                "name": "Norway Fjords Expedition",
                "country_code": "NO",
                "date_start": date(2024, 6, 15),
                "date_end": date(2024, 6, 25),
                "entries": [
                    {
                        "type": "place",
                        "title": "Trolltunga Hike",
                        "notes": "14 hours round trip. Worth it.",
                    },
                    {
                        "type": "experience",
                        "title": "Midnight Sun Kayaking",
                        "notes": "Paddling at 11pm.",
                    },
                ],
            },
        ],
    },
    {
        "username": "bella_costa",
        "home_country_code": "BR",
        "travel_motives": ["Beach", "Nightlife", "Music"],
        "persona_tags": ["Beach Lover", "Party Traveler"],
        "trips": [
            {
                "name": "Bali Beach Escape",
                "country_code": "ID",
                "date_start": date(2024, 7, 1),
                "date_end": date(2024, 7, 14),
                "entries": [
                    {
                        "type": "place",
                        "title": "Uluwatu Temple Sunset",
                        "notes": "Kecak dance with ocean backdrop.",
                    },
                    {
                        "type": "experience",
                        "title": "Beach Club Day",
                        "notes": "Potato Head vibes.",
                    },
                    {
                        "type": "stay",
                        "title": "Rice Terrace Villa",
                        "notes": "Ubud is magical.",
                    },
                ],
            },
        ],
    },
    {
        "username": "david_explores",
        "home_country_code": "KR",
        "travel_motives": ["Work", "Coffee", "Urban"],
        "persona_tags": ["Digital Nomad", "Urban Explorer"],
        "trips": [
            {
                "name": "Lisbon Digital Nomad Life",
                "country_code": "PT",
                "date_start": date(2024, 3, 1),
                "date_end": date(2024, 3, 31),
                "entries": [
                    {
                        "type": "place",
                        "title": "Alfama Neighborhood",
                        "notes": "Lost in narrow streets.",
                    },
                    {
                        "type": "food",
                        "title": "Pastel de Nata Hunt",
                        "notes": "Manteigaria wins.",
                    },
                    {
                        "type": "experience",
                        "title": "Co-working with Ocean View",
                        "notes": "Best office ever.",
                    },
                ],
            },
        ],
    },
]
