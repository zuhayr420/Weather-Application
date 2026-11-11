import httpx
from typing import Dict, Any

class AirQualityService:
    BASE_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

    @staticmethod
    async def get_air_quality(lat: float, lon: float) -> Dict[str, Any]:
        """Fetch current and hourly air quality from Open-Meteo."""
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,dust,uv_index,european_aqi",
            "hourly": "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide",
            "forecast_days": 2,
            "timezone": "auto"
        }
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    AirQualityService.BASE_URL,
                    params=params,
                    timeout=15.0
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                return {"error": f"Failed to fetch air quality data: {str(e)}"}
