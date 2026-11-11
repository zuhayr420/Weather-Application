"""
Historical Weather Service
Uses Open-Meteo Archive API (free, no key) to fetch the same calendar date
for the past 5 years and compute statistical baselines for anomaly detection.
"""
import httpx
from datetime import date, timedelta
from typing import Dict, Any

class HistoricalService:
    ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

    @staticmethod
    async def get_historical_baseline(lat: float, lon: float, month: int, day: int) -> Dict[str, Any]:
        """
        Fetch same calendar date for the past 5 years and return
        mean + std-dev for temperature, precipitation, and wind speed.
        """
        current_year = date.today().year
        years = range(current_year - 5, current_year)

        temp_vals, precip_vals, wind_vals, humidity_vals = [], [], [], []

        async with httpx.AsyncClient(timeout=20.0) as client:
            for year in years:
                try:
                    target = date(year, month, day)
                    # Fetch a 3-day window centred on the target date for robustness
                    start = (target - timedelta(days=1)).isoformat()
                    end   = (target + timedelta(days=1)).isoformat()

                    params = {
                        "latitude":   lat,
                        "longitude":  lon,
                        "start_date": start,
                        "end_date":   end,
                        "daily": "temperature_2m_mean,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean",
                        "timezone": "auto",
                    }

                    r = await client.get(HistoricalService.ARCHIVE_URL, params=params)
                    r.raise_for_status()
                    d = r.json().get("daily", {})

                    temps = d.get("temperature_2m_mean", [])
                    precips = d.get("precipitation_sum", [])
                    winds = d.get("wind_speed_10m_max", [])
                    humidities = d.get("relative_humidity_2m_mean", [])

                    # Use the middle value (target date)
                    if len(temps) >= 2:
                        t = temps[1]
                        p = precips[1]
                        w = winds[1]
                        h = humidities[1] if humidities else None
                        if t is not None: temp_vals.append(t)
                        if p is not None: precip_vals.append(p)
                        if w is not None: wind_vals.append(w)
                        if h is not None: humidity_vals.append(h)

                except Exception:
                    continue  # Skip years where data is unavailable

        def stats(vals):
            if not vals:
                return None
            n = len(vals)
            mean = sum(vals) / n
            variance = sum((v - mean) ** 2 for v in vals) / n
            std = variance ** 0.5
            return {"mean": round(mean, 2), "std": round(std, 2), "years": n}

        result = {
            "temperature": stats(temp_vals),
            "precipitation": stats(precip_vals),
            "wind_speed": stats(wind_vals),
            "humidity": stats(humidity_vals),
            "month": month,
            "day": day,
        }

        if all(v is None for v in [result["temperature"], result["precipitation"], result["wind_speed"]]):
            return {"error": "Historical baseline unavailable for this location and date."}

        return result
