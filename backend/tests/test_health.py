"""Tests for the health check endpoint."""

from fastapi.testclient import TestClient


def test_health_check_returns_ok(client: TestClient) -> None:
    """Test that the health check endpoint returns status ok."""
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_check_returns_json(client: TestClient) -> None:
    """Test that the health check endpoint returns valid JSON."""
    response = client.get("/health")

    assert response.headers["content-type"] == "application/json"
    data = response.json()
    assert "status" in data
