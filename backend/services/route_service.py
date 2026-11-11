import httpx
import json
from typing import Dict, Any, List, Tuple

class RouteService:
    OSRM_URL = "http://router.project-osrm.org/route/v1/driving"
    WEATHER_URL = "https://api.open-meteo.com/v1/forecast"

    # WMO codes that indicate dangerous driving conditions
    DANGEROUS_WMO = {82, 95, 96, 99, 75, 77, 86}
    MODERATE_WMO  = {45, 48, 51, 53, 55, 61, 63, 65, 71, 73, 80, 81, 85}

    @staticmethod
    async def get_route(
        origin_lat: float, origin_lon: float,
        dest_lat: float, dest_lon: float
    ) -> Dict[str, Any]:
        """Get the driving route between two coordinates using OSRM."""
        url = f"{RouteService.OSRM_URL}/{origin_lon},{origin_lat};{dest_lon},{dest_lat}"
        params = {
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
            "annotations": "false"
        }
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url, params=params, timeout=15.0)
                resp.raise_for_status()
                data = resp.json()

                if data.get("code") != "Ok" or not data.get("routes"):
                    return {"error": "No route found between these locations."}

                route = data["routes"][0]
                geometry = route["geometry"]["coordinates"]  # list of [lon, lat]
                distance_m = route["distance"]
                duration_s = route["duration"]

                # Sample 8 evenly-spaced waypoints along the route for weather checks
                waypoints = RouteService._sample_waypoints(geometry, n=8)

                # Fetch weather for each waypoint concurrently
                weather_points = await RouteService._fetch_waypoint_weather(waypoints)

                # Assess overall safety
                safety = RouteService._assess_safety(weather_points)

                return {
                    "geometry": geometry,
                    "distance_km": round(distance_m / 1000, 1),
                    "duration_min": round(duration_s / 60),
                    "waypoints": weather_points,
                    "safety": safety
                }
            except httpx.HTTPError as e:
                return {"error": f"Routing service error: {str(e)}"}

    @staticmethod
    def _sample_waypoints(coords: List[List[float]], n: int = 8) -> List[Tuple[float, float]]:
        """Sample n evenly-spaced [lat, lon] tuples from a coordinate list."""
        if len(coords) <= n:
            return [(c[1], c[0]) for c in coords]

        step = (len(coords) - 1) / (n - 1)
        sampled = []
        for i in range(n):
            idx = min(round(i * step), len(coords) - 1)
            c = coords[idx]
            sampled.append((c[1], c[0]))  # lat, lon
        return sampled

    @staticmethod
    async def _fetch_waypoint_weather(
        waypoints: List[Tuple[float, float]]
    ) -> List[Dict[str, Any]]:
        """Fetch current weather for each waypoint in parallel."""
        async with httpx.AsyncClient() as client:
            tasks = []
            for lat, lon in waypoints:
                tasks.append(
                    client.get(
                        RouteService.WEATHER_URL,
                        params={
                            "latitude": lat,
                            "longitude": lon,
                            "current": "temperature_2m,weather_code,wind_speed_10m,precipitation,relative_humidity_2m",
                            "timezone": "auto",
                        },
                        timeout=10.0
                    )
                )

            results = []
            for i, task in enumerate(tasks):
                try:
                    resp = await task
                    resp.raise_for_status()
                    d = resp.json()
                    cur = d.get("current", {})
                    wcode = cur.get("weather_code", 0)
                    wind = cur.get("wind_speed_10m", 0)
                    precip = cur.get("precipitation", 0)

                    danger = RouteService._point_danger(wcode, wind)

                    results.append({
                        "lat": waypoints[i][0],
                        "lon": waypoints[i][1],
                        "temp": cur.get("temperature_2m"),
                        "weather_code": wcode,
                        "wind_kmh": wind,
                        "precip_mm": precip,
                        "humidity": cur.get("relative_humidity_2m"),
                        "danger": danger,
                    })
                except Exception:
                    results.append({
                        "lat": waypoints[i][0],
                        "lon": waypoints[i][1],
                        "danger": "unknown",
                        "error": True
                    })
            return results

    @staticmethod
    def _point_danger(wmo_code: int, wind_kmh: float) -> str:
        """Return 'safe', 'moderate', or 'dangerous' for a point."""
        if wmo_code in RouteService.DANGEROUS_WMO or wind_kmh >= 65:
            return "dangerous"
        if wmo_code in RouteService.MODERATE_WMO or wind_kmh >= 30:
            return "moderate"
        return "safe"

    @staticmethod
    def _assess_safety(weather_points: List[Dict]) -> Dict[str, Any]:
        """Compute overall trip safety from all waypoint assessments."""
        levels = [p.get("danger", "safe") for p in weather_points]
        worst_conditions = []

        if "dangerous" in levels:
            level = "dangerous"
            label = "⚠️ Dangerous — Not recommended to travel"
            color = "#ef4444"
            advice = (
                "Severe weather conditions detected along this route. "
                "High winds, heavy rain, snowstorms, or thunderstorms may be present. "
                "Avoid travelling if possible. If you must travel, drive at reduced speed, "
                "maintain large following distances, and keep emergency supplies."
            )
        elif "moderate" in levels:
            level = "moderate"
            label = "🔶 Moderate — Travel with caution"
            color = "#f59e0b"
            advice = (
                "Mild to moderate adverse weather detected along parts of this route. "
                "Rain, fog, or strong winds may reduce visibility and road grip. "
                "Ensure your vehicle is roadworthy, use headlights, and drive carefully."
            )
        else:
            level = "safe"
            label = "✅ Safe — Good conditions for travel"
            color = "#22c55e"
            advice = (
                "Weather conditions along the route appear generally favourable. "
                "Always stay alert, observe local speed limits, and check for any "
                "local road updates before departing."
            )

        danger_count    = levels.count("dangerous")
        moderate_count  = levels.count("moderate")
        safe_count      = levels.count("safe")

        # Estimate % of route affected
        total = len(levels)
        pct_affected = round((danger_count + moderate_count) / total * 100) if total else 0

        return {
            "level": level,
            "label": label,
            "color": color,
            "advice": advice,
            "dangerous_segments": danger_count,
            "moderate_segments": moderate_count,
            "safe_segments": safe_count,
            "pct_affected": pct_affected
        }
