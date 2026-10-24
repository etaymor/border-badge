"""Tests for verifying Supabase access tokens across the JWT key migration.

Supabase's asymmetric signing keys (ES256/RS256, published as a JWKS) replace
the legacy shared HS256 secret. During the migration both kinds of token are
in flight, so verification must accept each through its own key source and
refuse every way of crossing them.
"""

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jwt.algorithms import ECAlgorithm

from app.core import security
from app.core.security import AuthUser, get_current_user, get_optional_user

SUPABASE_URL = "https://test.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
LEGACY_SECRET = "legacy-hs256-secret-that-leaked"
USER_ID = "8f6c7d1e-3a2b-4c5d-9e8f-0a1b2c3d4e5f"


class _Settings:
    def __init__(self, jwt_secret: str = LEGACY_SECRET) -> None:
        self.supabase_url = SUPABASE_URL
        self.supabase_jwt_secret = jwt_secret


class _JwksClient:
    """Stub shared HTTP client serving a JWKS document and counting fetches."""

    def __init__(self, keys: list[dict[str, Any]]) -> None:
        self.keys = keys
        self.calls: list[str] = []

    async def get(self, url: str, **_: Any) -> httpx.Response:
        self.calls.append(url)
        return httpx.Response(
            200, json={"keys": self.keys}, request=httpx.Request("GET", url)
        )


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims = {
        "sub": USER_ID,
        "email": "traveler@example.com",
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + 3600,
        "role": "authenticated",
    }
    claims.update(overrides)
    return claims


def _signing_key(kid: str) -> tuple[ec.EllipticCurvePrivateKey, dict[str, Any]]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_jwk = ECAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    public_jwk.update({"kid": kid, "alg": "ES256", "use": "sig"})
    return private_key, public_jwk


def _es256_token(private_key: ec.EllipticCurvePrivateKey, kid: str, **claims) -> str:
    return jwt.encode(
        _claims(**claims), private_key, algorithm="ES256", headers={"kid": kid}
    )


def _credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


@pytest.fixture(autouse=True)
def _fresh_jwks_cache():
    security.jwks_cache.clear()
    yield
    security.jwks_cache.clear()


@pytest.fixture
def signing_key():
    return _signing_key("es256-current")


@pytest.fixture
def jwks_client(monkeypatch, signing_key) -> _JwksClient:
    client = _JwksClient([signing_key[1]])
    monkeypatch.setattr(security, "get_http_client", lambda: client)
    return client


def _use_settings(monkeypatch, settings: _Settings) -> None:
    monkeypatch.setattr(security, "get_settings", lambda: settings)


@pytest.mark.asyncio
async def test_es256_token_verified_through_jwks(
    monkeypatch, signing_key, jwks_client
) -> None:
    _use_settings(monkeypatch, _Settings())
    token = _es256_token(signing_key[0], "es256-current")

    user = await get_current_user(_credentials(token))

    assert isinstance(user, AuthUser)
    assert user.id == USER_ID
    assert jwks_client.calls == [f"{ISSUER}/.well-known/jwks.json"]


@pytest.mark.asyncio
async def test_es256_verifies_after_legacy_secret_is_removed(
    monkeypatch, signing_key, jwks_client
) -> None:
    """The end state: no shared secret configured, asymmetric tokens still work."""
    _use_settings(monkeypatch, _Settings(jwt_secret=""))
    token = _es256_token(signing_key[0], "es256-current")

    user = await get_current_user(_credentials(token))

    assert user.id == USER_ID


@pytest.mark.asyncio
async def test_jwks_is_cached_between_requests(
    monkeypatch, signing_key, jwks_client
) -> None:
    _use_settings(monkeypatch, _Settings())
    token = _es256_token(signing_key[0], "es256-current")

    await get_current_user(_credentials(token))
    await get_current_user(_credentials(token))

    assert len(jwks_client.calls) == 1


@pytest.mark.asyncio
async def test_unknown_kid_refreshes_once_then_rejects(
    monkeypatch, signing_key, jwks_client
) -> None:
    _use_settings(monkeypatch, _Settings())
    stranger_key, _ = _signing_key("not-published")
    token = _es256_token(stranger_key, "not-published")

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(_credentials(token))

    assert exc_info.value.status_code == 401
    assert len(jwks_client.calls) == 1


@pytest.mark.asyncio
async def test_rotated_in_key_is_picked_up_without_restart(
    monkeypatch, signing_key, jwks_client
) -> None:
    """A key published after the cache filled is found by the refresh."""
    _use_settings(monkeypatch, _Settings())
    await get_current_user(_credentials(_es256_token(signing_key[0], "es256-current")))

    new_key, new_jwk = _signing_key("es256-next")
    jwks_client.keys.append(new_jwk)
    monkeypatch.setattr(security.jwks_cache, "min_refresh_interval", 0)

    user = await get_current_user(_credentials(_es256_token(new_key, "es256-next")))

    assert user.id == USER_ID
    assert len(jwks_client.calls) == 2


@pytest.mark.asyncio
async def test_es256_signed_by_wrong_key_with_known_kid_rejected(
    monkeypatch, signing_key, jwks_client
) -> None:
    _use_settings(monkeypatch, _Settings())
    impostor, _ = _signing_key("es256-current")
    token = _es256_token(impostor, "es256-current")

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(_credentials(token))

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_es256_wrong_issuer_and_audience_rejected(
    monkeypatch, signing_key, jwks_client
) -> None:
    _use_settings(monkeypatch, _Settings())
    for bad in ({"iss": "https://evil.supabase.co/auth/v1"}, {"aud": "anon"}):
        token = _es256_token(signing_key[0], "es256-current", **bad)
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(_credentials(token))
        assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_hs256_accepted_while_legacy_secret_configured(monkeypatch) -> None:
    _use_settings(monkeypatch, _Settings())
    token = jwt.encode(_claims(), LEGACY_SECRET, algorithm="HS256")

    user = await get_current_user(_credentials(token))

    assert user.id == USER_ID


@pytest.mark.asyncio
async def test_hs256_rejected_once_legacy_secret_removed(
    monkeypatch, jwks_client
) -> None:
    """Removing SUPABASE_JWT_SECRET is what stops forged tokens on our API."""
    _use_settings(monkeypatch, _Settings(jwt_secret=""))
    forged = jwt.encode(_claims(), LEGACY_SECRET, algorithm="HS256")

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(_credentials(forged))
    assert exc_info.value.status_code == 401
    assert await get_optional_user(_credentials(forged)) is None


def _hs256_token_raw(claims: dict[str, Any], hmac_key: bytes, kid: str) -> str:
    """Hand-roll an HS256 token; PyJWT refuses to sign with a JWK-shaped key."""
    header = {"alg": "HS256", "typ": "JWT", "kid": kid}
    signing_input = b".".join(
        base64.urlsafe_b64encode(json.dumps(part).encode()).rstrip(b"=")
        for part in (header, claims)
    )
    signature = hmac.new(hmac_key, signing_input, hashlib.sha256).digest()
    return (
        signing_input + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")
    ).decode()


@pytest.mark.asyncio
async def test_hs256_signed_with_public_jwk_rejected(
    monkeypatch, signing_key, jwks_client
) -> None:
    """Algorithm confusion: an HMAC over the public key must never verify."""
    _use_settings(monkeypatch, _Settings(jwt_secret=""))
    public_jwk = signing_key[1]
    for hmac_key in (json.dumps(public_jwk).encode(), public_jwk["x"].encode()):
        token = _hs256_token_raw(_claims(), hmac_key, kid="es256-current")
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(_credentials(token))
        assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_alg_none_rejected(monkeypatch, jwks_client) -> None:
    _use_settings(monkeypatch, _Settings())
    token = jwt.encode(_claims(), None, algorithm="none")

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(_credentials(token))

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_jwks_fetch_failure_rejects_without_crashing(monkeypatch) -> None:
    class _Down:
        async def get(self, url: str, **_: Any) -> httpx.Response:
            raise httpx.ConnectError("down", request=httpx.Request("GET", url))

    monkeypatch.setattr(security, "get_http_client", lambda: _Down())
    _use_settings(monkeypatch, _Settings())
    private_key, _ = _signing_key("es256-current")

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(_credentials(_es256_token(private_key, "es256-current")))

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_sync_decode_uses_cached_keys_without_network(
    monkeypatch, signing_key, jwks_client
) -> None:
    """The rate-limit key function is sync, so it reads the cache only."""
    settings = _Settings()
    _use_settings(monkeypatch, settings)
    token = _es256_token(signing_key[0], "es256-current")

    with pytest.raises(jwt.InvalidTokenError):
        security.decode_supabase_token_cached(token, settings)
    assert jwks_client.calls == []

    await security.jwks_cache.refresh(SUPABASE_URL)
    payload = security.decode_supabase_token_cached(token, settings)

    assert payload["sub"] == USER_ID
