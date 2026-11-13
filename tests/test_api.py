"""
Unit and integration tests for Meridian Weather Application backend.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import _score_geocode_result, app

client = TestClient(app)


def test_health_check_endpoint():
    """Verify /api/health returns HTTP 200 and valid JSON schema."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "MeridianWeatherApp"
    assert data["version"] == "1.0.0"
    assert "timestamp" in data


def test_manifest_endpoint():
    """Verify web app manifest is served correctly."""
    response = client.get("/manifest.json")
    assert response.status_code == 200
    assert "application/json" in response.headers.get("content-type", "")
    data = response.json()
    assert "Meridian" in data["name"]
    assert "Meridian" in data["short_name"]


def test_spa_root_endpoint():
    """Verify root path serves index.html."""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    assert "Meridian" in response.text


def test_geocode_scoring_exact_match():
    """Exact city name match should receive higher rank than partial."""
    exact_item = {
        "name": "Tokyo",
        "display_name": "Tokyo, Japan",
        "category": "place",
        "type": "city",
    }
    partial_item = {
        "name": "Tokyo Hill",
        "display_name": "Tokyo Hill, Texas, USA",
        "category": "natural",
        "type": "hill",
    }
    score_exact = _score_geocode_result(exact_item, "Tokyo")
    score_partial = _score_geocode_result(partial_item, "Tokyo")
    assert score_exact > score_partial


def test_geocode_scoring_unrelated():
    """Unrelated result should receive severe penalty."""
    unrelated_item = {
        "name": "Berlin",
        "display_name": "Berlin, Germany",
        "category": "place",
        "type": "city",
    }
    score = _score_geocode_result(unrelated_item, "Honolulu")
    assert score < 0
