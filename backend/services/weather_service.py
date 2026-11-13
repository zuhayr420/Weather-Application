import httpx
from typing import Dict, Any

class WeatherService:
    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    @staticmethod
    async def get_weather(lat: float, lon: float, units: str = "celsius") -> Dict[str, Any]:
        """Fetch current, hourly, and daily weather from Open-Meteo."""
        
        # Mapping frontend units to Open-Meteo units
        temperature_unit = "celsius" if units == "celsius" else "fahrenheit"
        wind_speed_unit = "kmh" if units == "celsius" else "mph"
        precipitation_unit = "mm" if units == "celsius" else "inch"

        params = {
            "latitude": lat,
            "longitude": lon,
            "current": (
                "temperature_2m,relative_humidity_2m,apparent_temperature,"
                "is_day,precipitation,rain,weather_code,cloud_cover,"
                "surface_pressure,wind_speed_10m,wind_direction_10m,"
                "uv_index,visibility,dew_point_2m"
            ),
            "hourly": (
                "temperature_2m,relative_humidity_2m,apparent_temperature,"
                "precipitation_probability,precipitation,weather_code,"
                "wind_speed_10m,wind_direction_10m,uv_index,"
                "visibility,dew_point_2m,cloud_cover"
            ),
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max",

            "temperature_unit": temperature_unit,
            "wind_speed_unit": wind_speed_unit,
            "precipitation_unit": precipitation_unit,
            "timezone": "auto",
            "forecast_days": 7
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    WeatherService.BASE_URL,
                    params=params,
                    timeout=15.0
                )
                response.raise_for_status()
                data = response.json()
                return data
            except httpx.HTTPError as e:
                return {"error": f"Failed to fetch weather data: {str(e)}"}
