"""www host must 301 to the configured public origin."""

import pytest
from fastapi.testclient import TestClient

from app.main import settings as app_settings

WWW_HEADERS = {"host": "www.atlasi.app"}


@pytest.fixture
def public_origin(monkeypatch: pytest.MonkeyPatch) -> str:
    origin = "https://atlasi.app"
    monkeypatch.setattr(app_settings, "base_url", origin)
    return origin


def test_www_root_redirects_to_apex(client: TestClient, public_origin: str) -> None:
    response = client.get("/", headers=WWW_HEADERS, follow_redirects=False)
    assert response.status_code == 301
    assert response.headers["location"] == f"{public_origin}/"


def test_www_preserves_path_and_query(client: TestClient, public_origin: str) -> None:
    response = client.get(
        "/blog/best-polarsteps-alternatives?ref=nav",
        headers=WWW_HEADERS,
        follow_redirects=False,
    )
    assert response.status_code == 301
    assert (
        response.headers["location"]
        == f"{public_origin}/blog/best-polarsteps-alternatives?ref=nav"
    )


def test_www_head_redirects_to_apex(client: TestClient, public_origin: str) -> None:
    response = client.head("/", headers=WWW_HEADERS, follow_redirects=False)
    assert response.status_code == 301
    assert response.headers["location"] == f"{public_origin}/"


def test_apex_host_is_not_redirected(client: TestClient, public_origin: str) -> None:
    response = client.get("/", headers={"host": "atlasi.app"}, follow_redirects=False)
    assert response.status_code == 200


def test_unrelated_www_host_is_not_redirected(
    client: TestClient, public_origin: str
) -> None:
    response = client.get(
        "/", headers={"host": "www.example.com"}, follow_redirects=False
    )
    assert response.status_code == 200
