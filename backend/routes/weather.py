from fastapi import APIRouter, HTTPException, Query
from services.weather_service import WeatherService
from services.geocoding_service import GeocodingService
from services.air_quality_service import AirQualityService
import asyncio

router = APIRouter()

# ── Weather ────────────────────────────────────────────────────────────────────
@router.get("/weather")
async def get_weather(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    units: str = Query("celsius", description="celsius or fahrenheit")
):
    """Get current and forecasted weather for a location."""
    data = await WeatherService.get_weather(lat, lon, units)
    if "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])
    return data

# ── Geocode ────────────────────────────────────────────────────────────────────
@router.get("/geocode")
async def geocode(query: str = Query(...)):
    """Search for locations by name."""
    if not query or len(query.strip()) < 2:
        return {"results": []}
    data = await GeocodingService.search_location(query)
    if "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])
    return data

# ── Route planner ──────────────────────────────────────────────────────────────
@router.get("/route")
async def get_route(
    origin_lat: float = Query(...),
    origin_lon: float = Query(...),
    dest_lat:   float = Query(...),
    dest_lon:   float = Query(...),
):
    """Get a driving route with weather safety assessment."""
    from services.route_service import RouteService
    data = await RouteService.get_route(origin_lat, origin_lon, dest_lat, dest_lon)
    if "error" in data:
        raise HTTPException(status_code=400, detail=data["error"])
    return data

# ── Historical baseline (anomaly detection) ────────────────────────────────────
@router.get("/historical")
async def get_historical(
    lat:   float = Query(...),
    lon:   float = Query(...),
    month: int   = Query(..., ge=1, le=12),
    day:   int   = Query(..., ge=1, le=31),
):
    """Return 5-year historical weather baseline for anomaly detection."""
    from services.historical_service import HistoricalService
    data = await HistoricalService.get_historical_baseline(lat, lon, month, day)
    if "error" in data:
        raise HTTPException(status_code=503, detail=data["error"])
    return data

# ── Multi-location compare ─────────────────────────────────────────────────────
@router.get("/compare")
async def compare_locations(
    lats:  str = Query(..., description="Comma-separated latitudes"),
    lons:  str = Query(..., description="Comma-separated longitudes"),
    names: str = Query("", description="Comma-separated names"),
    units: str = Query("celsius"),
):
    """Fetch weather for 2–4 locations simultaneously."""
    try:
        lat_list  = [float(x.strip()) for x in lats.split(",")]
        lon_list  = [float(x.strip()) for x in lons.split(",")]
        name_list = [x.strip() for x in names.split(",")] if names else [""] * len(lat_list)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid lat/lon format.")

    if len(lat_list) != len(lon_list) or not (2 <= len(lat_list) <= 4):
        raise HTTPException(status_code=422, detail="Provide 2–4 matching lat/lon pairs.")

    tasks   = [WeatherService.get_weather(lat, lon, units) for lat, lon in zip(lat_list, lon_list)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    locations = []
    for i, (result, name) in enumerate(zip(results, name_list)):
        if isinstance(result, Exception) or "error" in result:
            locations.append({"name": name or f"Location {i+1}", "error": True})
            continue
        cur    = result.get("current", {})
        hourly = result.get("hourly", {})
        prob_list = hourly.get("precipitation_probability") or []
        locations.append({
            "name":        name or f"Location {i+1}",
            "temperature": cur.get("temperature_2m"),
            "feels_like":  cur.get("apparent_temperature"),
            "humidity":    cur.get("relative_humidity_2m"),
            "wind_speed":  cur.get("wind_speed_10m"),
            "precipitation": cur.get("precipitation"),
            "precip_prob": prob_list[0] if prob_list else None,
            "cloud_cover": cur.get("cloud_cover"),
            "weather_code": cur.get("weather_code"),
            "is_day":      cur.get("is_day", 1),
            "uv_index":    cur.get("uv_index"),
            "visibility":  cur.get("visibility"),
            "dew_point":   cur.get("dew_point_2m"),
            "pressure":    cur.get("surface_pressure"),
        })

    return {"locations": locations, "units": units}

# ── Air Quality ────────────────────────────────────────────────────────────────
@router.get("/air-quality")
async def get_air_quality(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
):
    """Get air quality index and pollutant levels."""
    data = await AirQualityService.get_air_quality(lat, lon)
    if "error" in data:
        raise HTTPException(status_code=503, detail=data["error"])
    return data
