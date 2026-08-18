"""Tests for the rate-limit key function (plan U5, KTD9 / R15).

Rate limits must key on the authenticated user when a JWT is present and
fall back to the client IP otherwise. The critical property: two users
behind one IP (office NAT, CGNAT) get independent limits.
"""

import jwt
from starlette.requests import Request

from app.main import get_rate_limit_key


def make_request(
    headers: dict[str, str] | None = None,
    client_host: str = "203.0.113.7",
) -> Request:
    """Build a minimal starlette Request for key-function unit tests."""
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "scheme": "http",
        "server": ("testserver", 80),
        "client": (client_host, 51234),
        "headers": [
            (k.lower().encode(), v.encode()) for k, v in (headers or {}).items()
        ],
    }
    return Request(scope)


def bearer(sub: str) -> dict[str, str]:
    token = jwt.encode({"sub": sub}, "irrelevant-secret", algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def test_two_users_behind_one_ip_have_independent_keys() -> None:
    """Same IP, different JWT subjects -> different rate-limit buckets."""
    key_a = get_rate_limit_key(make_request(bearer("user-a"), client_host="10.0.0.1"))
    key_b = get_rate_limit_key(make_request(bearer("user-b"), client_host="10.0.0.1"))

    assert key_a == "user:user-a"
    assert key_b == "user:user-b"
    assert key_a != key_b


def test_same_user_from_two_ips_shares_one_key() -> None:
    """The user bucket follows the account, not the network."""
    key_1 = get_rate_limit_key(make_request(bearer("user-a"), client_host="10.0.0.1"))
    key_2 = get_rate_limit_key(make_request(bearer("user-a"), client_host="10.9.9.9"))

    assert key_1 == key_2 == "user:user-a"


def test_unauthenticated_request_falls_back_to_ip() -> None:
    key = get_rate_limit_key(make_request(client_host="198.51.100.4"))
    assert key == "ip:198.51.100.4"


def test_malformed_bearer_token_falls_back_to_ip() -> None:
    key = get_rate_limit_key(
        make_request(
            {"Authorization": "Bearer not-a-jwt"},
            client_host="198.51.100.4",
        )
    )
    assert key == "ip:198.51.100.4"


def test_token_without_sub_falls_back_to_ip() -> None:
    token = jwt.encode({"role": "anon"}, "irrelevant-secret", algorithm="HS256")
    key = get_rate_limit_key(
        make_request(
            {"Authorization": f"Bearer {token}"},
            client_host="198.51.100.4",
        )
    )
    assert key == "ip:198.51.100.4"
