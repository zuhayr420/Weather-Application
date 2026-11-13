import httpx
from typing import Dict, Any

class GeocodingService:
    BASE_URL = "https://nominatim.openstreetmap.org/search"

    @staticmethod
    async def search_location(query: str) -> Dict[str, Any]:
        """Search for a location by name using OpenStreetMap Nominatim API for high precision."""
        async with httpx.AsyncClient() as client:
            try:
                headers = {
                    "User-Agent": "RealTimeWeatherApp/1.0 (zuhayr.dev@gmail.com)",
                    # Force English display names regardless of local script
                    "Accept-Language": "en"
                }
                response = await client.get(
                    GeocodingService.BASE_URL,
                    params={
                        "q": query,
                        "format": "json",
                        "limit": 10,
                        "addressdetails": 1,
                        "namedetails": 1,
                        "accept-language": "en"
                    },
                    headers=headers,
                    timeout=10.0
                )
                response.raise_for_status()
                data = response.json()

                # Format the response
                formatted_results = []
                for res in data:
                    address = res.get("address", {})
                    namedetails = res.get("namedetails", {})

                    # Use English name from namedetails if available, fallback to display_name parts
                    en_name = (
                        namedetails.get("name:en")
                        or namedetails.get("name")
                        or address.get("city")
                        or address.get("town")
                        or address.get("village")
                        or address.get("suburb")
                        or address.get("county")
                        or res.get("name", "")
                    )

                    country = (
                        namedetails.get("country:en")
                        or address.get("country", "")
                    )

                    admin1 = (
                        address.get("state")
                        or address.get("region")
                        or address.get("county")
                        or ""
                    )

                    if not en_name:
                        continue

                    formatted_results.append({
                        "id": res.get("place_id"),
                        "name": en_name,
                        "display_name": res.get("display_name", ""),
                        "latitude": float(res.get("lat")),
                        "longitude": float(res.get("lon")),
                        "country": country,
                        "admin1": admin1,
                        "type": res.get("type", ""),
                        "timezone": "auto"
                    })

                # Deduplicate by name + admin1 + country
                seen = set()
                unique_results = []
                for item in formatted_results:
                    identifier = f"{item['name'].lower()}-{item['admin1'].lower()}-{item['country'].lower()}"
                    if identifier not in seen:
                        seen.add(identifier)
                        unique_results.append(item)

                return {"results": unique_results}
            except httpx.HTTPError as e:
                return {"error": str(e), "results": []}
