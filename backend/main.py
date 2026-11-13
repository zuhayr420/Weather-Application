"""
Real-Time Weather App — backend
--------------------------------
FastAPI server that:
  1. Serves the static frontend (HTML/CSS/JS, manifest, service worker).
  2. Proxies the free third-party APIs so the browser never has to deal with
     CORS or usage-policy headers (Nominatim in particular requires a
     descriptive User-Agent).

Run with:
    pip install fastapi uvicorn httpx --break-system-packages
    uvicorn main:app --reload --port 8000

Then open http://localhost:8000
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

APP_NAME = "MeridianWeatherApp"
CONTACT = "admin@meridian-weather-app.internal"  # required by Nominatim usage policy
USER_AGENT = f"{APP_NAME}/2.0 ({CONTACT})"

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"

app = FastAPI(title=APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Tiny in-memory cache to be a polite API citizen and to speed up repeat hits
# ---------------------------------------------------------------------------
_CACHE: dict[str, tuple[float, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes — matches Open-Meteo's own update cadence


def _cache_get(key: str) -> Any | None:
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, value = hit
    if time.time() - ts > CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    _CACHE[key] = (time.time(), value)


async def _get_json(url: str, params: dict[str, Any], cache_key: str) -> Any:
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            url, params=params, headers={"User-Agent": USER_AGENT}
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
    data = resp.json()
    _cache_set(cache_key, data)
    return data


# ---------------------------------------------------------------------------
# API routes — all under /api/* so they never collide with static files
# ---------------------------------------------------------------------------
def _score_geocode_result(item: dict[str, Any], query: str) -> int:
    import re
    q_lower = query.lower().strip()
    q_tokens = [t.strip() for t in re.split(r"[, -]+", q_lower) if len(t.strip()) >= 2]

    name = (item.get("name") or "").lower()
    display = (item.get("display_name") or "").lower()
    cat = (item.get("category") or "").lower()
    typ = (item.get("type") or item.get("addresstype") or "").lower()

    score = 0

    # Exact full name match
    if name == q_lower:
        score += 160
    elif name.startswith(q_lower):
        score += 110

    matched_tokens = 0
    for tok in q_tokens:
        if tok == name:
            score += 85
            matched_tokens += 1
        elif tok in name:
            score += 50
            matched_tokens += 1
        elif tok in display:
            score += 35
            matched_tokens += 1

    # Token completeness bonus or penalty
    if len(q_tokens) > 0 and matched_tokens >= len(q_tokens):
        score += 65
    elif matched_tokens == 0:
        score -= 200  # Completely unrelated result

    # Place type preference
    preferred_types = {
        "city": 30, "town": 26, "village": 24, "hamlet": 22, "suburb": 18,
        "administrative": 20, "landmark": 28, "natural": 28, "water": 26,
        "lake": 26, "mountain": 26, "peak": 24, "valley": 26, "pass": 24,
        "tourist": 24, "attraction": 24, "place": 16
    }
    for pt, bonus in preferred_types.items():
        if pt in typ or pt in cat:
            score += bonus
            break

    # Highway / residential road penalty if query did not specify street
    if ("highway" in cat or typ in ["residential", "service", "track"]) and not any(
        k in q_lower for k in ["street", "road", "st", "rd", "ave", "lane", "marg", "chowk", "bazaar"]
    ):
        score -= 45

    return score


@app.get("/api/geocode")
async def geocode(q: str = Query(..., min_length=1)):
    """
    Deepest-Level Global Hybrid Geocoding Engine:
    1. Direct GPS Coordinate Parsing (Decimal & Cardinal).
    2. Smart Query Decomposition (stripping natural suffixes & splitting compound locations).
    3. Parallel Multi-Engine Gathering:
       - OpenStreetMap Nominatim (addresses, boundaries, places)
       - Komoot Photon Elasticsearch (OSM full-text POIs, micro-towns, roads)
       - Wikipedia MediaWiki Geosearch API (lakes, mountains, valleys, landmarks, hamlets)
       - Open-Meteo Global Geocoding (cities, municipalities, administrative units)
    4. Multi-Signal Relevance Scoring & Proximity Deduplication.
    """
    import asyncio
    import re

    q_clean = q.strip()
    cache_key = f"geo_deepest_v2:{q_clean.lower()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    # Check for direct Coordinate search
    coord_decimal = re.match(r"^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$", q_clean)
    coord_cardinal = re.match(r"^(\d+(?:\.\d+)?)[°\s]*([NSns])[,\s]+(\d+(?:\.\d+)?)[°\s]*([EWew])$", q_clean)

    if coord_decimal or coord_cardinal:
        if coord_decimal:
            lat = float(coord_decimal.group(1))
            lon = float(coord_decimal.group(2))
        else:
            lat = float(coord_cardinal.group(1)) * (-1 if coord_cardinal.group(2).upper() == "S" else 1)
            lon = float(coord_cardinal.group(3)) * (-1 if coord_cardinal.group(4).upper() == "W" else 1)

        if -90 <= lat <= 90 and -180 <= lon <= 180:
            display_title = f"{lat:.4f}°, {lon:.4f}°"
            rev_name = "Exact GPS Coordinates"
            try:
                rev_url = "https://nominatim.openstreetmap.org/reverse"
                async with httpx.AsyncClient(timeout=4) as client:
                    r = await client.get(
                        rev_url,
                        params={"lat": lat, "lon": lon, "format": "jsonv2"},
                        headers={"User-Agent": USER_AGENT},
                    )
                    if r.status_code == 200:
                        rd = r.json()
                        rev_name = rd.get("display_name", display_title)
            except Exception:
                pass

            return [{
                "place_id": f"coord_{lat}_{lon}",
                "name": display_title,
                "display_name": rev_name,
                "lat": str(lat),
                "lon": str(lon),
                "type": "coordinates",
                "category": "coordinates",
                "addresstype": "coordinates",
                "address": {"city": display_title, "country": "GPS Point"}
            }]

    # Generate smart subqueries
    subqueries = [q_clean]
    cleaned = re.sub(
        r"\b(lake|valley|river|beach|mount|mountain|peak|falls|waterfall|pass|forest|sanctuary|national park|park|dam|fort|temple|palace)\b",
        "",
        q_clean,
        flags=re.I,
    ).strip()
    if cleaned and cleaned.lower() != q_clean.lower() and len(cleaned) >= 3:
        subqueries.append(cleaned)
    if "," in q_clean:
        first_part = q_clean.split(",")[0].strip()
        if len(first_part) >= 3 and first_part not in subqueries:
            subqueries.append(first_part)

    results: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=4.2, headers={"User-Agent": USER_AGENT}) as client:
        tasks = []

        # 1. Komoot Photon Elasticsearch (POIs, micro-towns, hamlets, roads)
        for sq in subqueries[:2]:
            tasks.append((
                "photon",
                sq,
                client.get("https://photon.komoot.io/api/", params={"q": sq, "limit": 8}),
            ))

        # 2. Wikipedia MediaWiki Geosearch API (lakes, peaks, valleys, landmarks, villages)
        for sq in subqueries[:2]:
            tasks.append((
                "wiki",
                sq,
                client.get(
                    "https://en.wikipedia.org/w/api.php",
                    params={
                        "action": "query",
                        "prop": "coordinates|description",
                        "generator": "search",
                        "gsrsearch": sq,
                        "gsrlimit": 4,
                        "format": "json",
                    },
                ),
            ))

        # 3. Open-Meteo Geocoding (global cities, towns, administrative units)
        tasks.append((
            "openmeteo",
            q_clean,
            client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": q_clean, "count": 8, "language": "en", "format": "json"},
            ),
        ))
        if len(subqueries) > 1:
            tasks.append((
                "openmeteo",
                subqueries[1],
                client.get(
                    "https://geocoding-api.open-meteo.com/v1/search",
                    params={"name": subqueries[1], "count": 6, "language": "en", "format": "json"},
                ),
            ))

        # 4. OpenStreetMap Nominatim
        for sq in subqueries[:2]:
            tasks.append((
                "nominatim",
                sq,
                client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={
                        "q": sq,
                        "format": "jsonv2",
                        "addressdetails": 1,
                        "namedetails": 1,
                        "limit": 8,
                    },
                ),
            ))

        responses = await asyncio.gather(*[t[2] for t in tasks], return_exceptions=True)

        for (source, query_term, _), resp in zip(tasks, responses):
            if isinstance(resp, Exception) or getattr(resp, "status_code", 0) != 200:
                continue
            try:
                data = resp.json()
            except Exception:
                continue

            if source == "photon":
                for f in data.get("features", []):
                    props = f.get("properties", {})
                    coords = f.get("geometry", {}).get("coordinates", [0, 0])
                    name = props.get("name") or props.get("street") or query_term
                    subparts = [
                        props.get("street") if props.get("street") != name else "",
                        props.get("district") or props.get("suburb"),
                        props.get("city") or props.get("town") or props.get("village"),
                        props.get("state"),
                        props.get("country"),
                    ]
                    region = ", ".join([p for p in subparts if p])
                    results.append({
                        "place_id": f"pho_{props.get('osm_id', f'{coords[1]}_{coords[0]}')}",
                        "name": name,
                        "display_name": f"{name}, {region}" if region else name,
                        "lat": str(coords[1]),
                        "lon": str(coords[0]),
                        "type": props.get("osm_value") or "place",
                        "category": props.get("osm_key") or "place",
                        "addresstype": props.get("type") or "place",
                        "address": {
                            "road": props.get("street"),
                            "suburb": props.get("district") or props.get("suburb"),
                            "city": props.get("city") or props.get("town"),
                            "state": props.get("state"),
                            "country": props.get("country"),
                            "postcode": props.get("postcode"),
                        },
                    })

            elif source == "nominatim" and isinstance(data, list):
                for item in data:
                    results.append(item)

            elif source == "openmeteo":
                for item in data.get("results", []):
                    reg = ", ".join([item.get(k) for k in ["admin2", "admin1", "country"] if item.get(k)])
                    results.append({
                        "place_id": f"om_{item.get('id')}",
                        "name": item.get("name"),
                        "display_name": f"{item.get('name')}, {reg}" if reg else item.get("name"),
                        "lat": str(item.get("latitude")),
                        "lon": str(item.get("longitude")),
                        "type": "city",
                        "category": "place",
                        "addresstype": "city",
                        "address": {
                            "city": item.get("name"),
                            "state": item.get("admin1"),
                            "country": item.get("country"),
                        },
                    })

            elif source == "wiki":
                pages = data.get("query", {}).get("pages", {})
                for pid, page in pages.items():
                    coords = page.get("coordinates", [{}])[0]
                    if coords.get("lat") is not None and coords.get("lon") is not None:
                        title = page.get("title")
                        desc = page.get("description", "Landmark / Geographic location")
                        results.append({
                            "place_id": f"wiki_{pid}",
                            "name": title,
                            "display_name": f"{title}, {desc}",
                            "lat": str(coords.get("lat")),
                            "lon": str(coords.get("lon")),
                            "type": "landmark",
                            "category": "natural",
                            "addresstype": "landmark",
                            "address": {
                                "city": title,
                                "state": desc,
                                "country": "",
                            },
                        })

    # Score and rank results
    scored: list[tuple[int, dict[str, Any]]] = []
    for r in results:
        s = _score_geocode_result(r, q_clean)
        if s > 0:
            scored.append((s, r))

    scored.sort(key=lambda x: x[0], reverse=True)

    # Deduplicate by geographic proximity (~1km)
    seen_coords = set()
    deduped = []
    for s, item in scored:
        try:
            lat = round(float(item.get("lat", 0)), 2)
            lon = round(float(item.get("lon", 0)), 2)
            key = f"{lat}:{lon}"
            if key not in seen_coords:
                seen_coords.add(key)
                deduped.append(item)
        except (ValueError, TypeError):
            continue

    final_results = deduped[:14]
    _cache_set(cache_key, final_results)
    return final_results


@app.get("/api/reverse")
async def reverse_geocode(lat: float, lon: float):
    """Reverse geocoding — used by the 'Use my location' button."""
    url = "https://nominatim.openstreetmap.org/reverse"
    params = {"lat": lat, "lon": lon, "format": "jsonv2"}
    return await _get_json(url, params, f"rev:{lat:.3f},{lon:.3f}")


@app.get("/api/weather")
async def weather(lat: float, lon: float, unit: str = "celsius"):
    """Current + hourly (48h) + daily (7d) forecast from Open-Meteo."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ",".join(
            [
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "is_day",
                "precipitation",
                "weather_code",
                "cloud_cover",
                "pressure_msl",
                "wind_speed_10m",
                "wind_direction_10m",
                "wind_gusts_10m",
                "uv_index",
            ]
        ),
        "hourly": ",".join(
            [
                "temperature_2m",
                "precipitation_probability",
                "precipitation",
                "weather_code",
                "wind_speed_10m",
                "relative_humidity_2m",
                "apparent_temperature",
                "uv_index",
                "visibility",
                "dew_point_2m",
            ]
        ),
        "daily": ",".join(
            [
                "weather_code",
                "temperature_2m_max",
                "temperature_2m_min",
                "sunrise",
                "sunset",
                "precipitation_probability_max",
                "uv_index_max",
                "wind_speed_10m_max",
            ]
        ),
        "temperature_unit": "fahrenheit" if unit == "fahrenheit" else "celsius",
        "wind_speed_unit": "mph" if unit == "fahrenheit" else "kmh",
        "precipitation_unit": "inch" if unit == "fahrenheit" else "mm",
        "timezone": "auto",
        "forecast_days": 8,
    }
    return await _get_json(
        url, params, f"wx:{lat:.3f},{lon:.3f}:{unit}"
    )


@app.get("/api/archive")
async def archive(lat: float, lon: float, month: int, day: int):
    """5-year historical baseline for the same calendar date (anomaly detection)."""
    import datetime

    today = datetime.date.today()
    years = [today.year - y for y in range(1, 6)]
    dates = []
    for y in years:
        try:
            d = datetime.date(y, month, day)
        except ValueError:
            d = datetime.date(y, 3, 1)  # Feb 29 fallback
        dates.append(d)
    start = min(dates)
    end = max(dates)
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "timezone": "auto",
    }
    data = await _get_json(
        url, params, f"arc:{lat:.3f},{lon:.3f}:{month}-{day}"
    )
    # Filter down to just the matching month/day across the fetched range
    out_dates, out_max, out_min, out_precip = [], [], [], []
    daily = data.get("daily", {})
    for i, ds in enumerate(daily.get("time", [])):
        y, m, d = (int(p) for p in ds.split("-"))
        if m == month and d == day:
            out_dates.append(ds)
            out_max.append(daily["temperature_2m_max"][i])
            out_min.append(daily["temperature_2m_min"][i])
            out_precip.append(daily["precipitation_sum"][i])
    return {
        "dates": out_dates,
        "temperature_2m_max": out_max,
        "temperature_2m_min": out_min,
        "precipitation_sum": out_precip,
    }


@app.get("/api/route")
async def route(
    from_lat: float, from_lon: float, to_lat: float, to_lon: float
):
    """Driving route geometry + duration from the public OSRM demo server."""
    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{from_lon},{from_lat};{to_lon},{to_lat}"
    )
    params = {"overview": "full", "geometries": "geojson", "steps": "false"}
    return await _get_json(
        url,
        params,
        f"route:{from_lat:.3f},{from_lon:.3f}-{to_lat:.3f},{to_lon:.3f}",
    )


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------
app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
app.mount("/icons", StaticFiles(directory=FRONTEND_DIR / "icons"), name="icons")


@app.get("/manifest.json")
async def manifest():
    return FileResponse(FRONTEND_DIR / "manifest.json")


@app.get("/sw.js")
async def service_worker():
    return FileResponse(FRONTEND_DIR / "sw.js", media_type="application/javascript")


@app.get("/{full_path:path}")
async def spa(full_path: str):
    return FileResponse(FRONTEND_DIR / "index.html")
