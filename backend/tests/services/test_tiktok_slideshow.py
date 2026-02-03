"""Tests for TikTok slideshow parsing."""

import json

from app.services.tiktok_slideshow import parse_tiktok_slideshow_html


def test_parse_sigi_state_slideshow():
    sigi_state = {
        "ItemModule": {
            "123": {
                "desc": "Best cafes in Paris",
                "imagePost": {
                    "images": [
                        {
                            "imageURL": {
                                "urlList": [
                                    "https://example.com/img1_small.jpg",
                                    "https://example.com/img1_large.jpg",
                                ]
                            }
                        },
                        {
                            "imageURL": {
                                "urlList": [
                                    "https://example.com/img2_large.jpg",
                                ]
                            }
                        },
                    ]
                },
            }
        }
    }
    html = (
        '<html><script id="SIGI_STATE" type="application/json">'
        f"{json.dumps(sigi_state)}"
        "</script></html>"
    )

    metadata = parse_tiktok_slideshow_html(html)

    assert metadata is not None
    assert metadata.caption == "Best cafes in Paris"
    assert metadata.source == "sigi_state"
    assert metadata.image_urls == [
        "https://example.com/img1_large.jpg",
        "https://example.com/img2_large.jpg",
    ]


def test_parse_next_data_slideshow():
    next_data = {
        "props": {
            "pageProps": {
                "itemInfo": {
                    "itemStruct": {
                        "desc": "Tokyo spots",
                        "imagePost": {
                            "images": [
                                {
                                    "imageURL": {
                                        "urlList": [
                                            "https://example.com/a.jpg",
                                            "https://example.com/a_2.jpg",
                                        ]
                                    }
                                }
                            ]
                        },
                    }
                }
            }
        }
    }
    html = (
        '<html><script id="__NEXT_DATA__">'
        f"{json.dumps(next_data)}"
        "</script></html>"
    )

    metadata = parse_tiktok_slideshow_html(html)

    assert metadata is not None
    assert metadata.caption == "Tokyo spots"
    assert metadata.source == "next_data"
    assert metadata.image_urls == ["https://example.com/a_2.jpg"]


def test_parse_universal_data_slideshow():
    universal_data = {
        "__DEFAULT_SCOPE__": {
            "webapp.video-detail": {
                "itemInfo": {
                    "itemStruct": {
                        "desc": "Lisbon list",
                        "imagePost": {
                            "images": [
                                {
                                    "imageURL": {
                                        "urlList": [
                                            "https://example.com/one.jpg",
                                            "https://example.com/one_big.jpg",
                                        ]
                                    }
                                }
                            ]
                        },
                    }
                }
            }
        }
    }
    html = (
        '<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">'
        f"{json.dumps(universal_data)}"
        "</script></html>"
    )

    metadata = parse_tiktok_slideshow_html(html)

    assert metadata is not None
    assert metadata.caption == "Lisbon list"
    assert metadata.source == "universal_data"
    assert metadata.image_urls == ["https://example.com/one_big.jpg"]
