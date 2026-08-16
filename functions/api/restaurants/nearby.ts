import type { RestaurantResult } from "../../../shared/schema";

interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export function mapPlace(p: any): RestaurantResult {
  return {
    placeId: p.id,
    name: p.displayName?.text || "",
    vicinity: p.shortFormattedAddress || p.formattedAddress || "",
    rating: p.rating || 0,
    userRatingsTotal: p.userRatingCount || 0,
    priceLevel: PRICE_LEVELS[p.priceLevel] || 0,
    photoName: p.photos?.[0]?.name || null,
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    openNow: p.currentOpeningHours?.openNow ?? null,
    types: p.types || [],
  };
}

export const PLACE_FIELDS = [
  "id",
  "displayName",
  "shortFormattedAddress",
  "formattedAddress",
  "rating",
  "userRatingCount",
  "priceLevel",
  "photos",
  "location",
  "currentOpeningHours.openNow",
  "types",
];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const lat = parseFloat(url.searchParams.get("lat") || "");
    const lng = parseFloat(url.searchParams.get("lng") || "");
    const radius = Math.min(Math.max(parseInt(url.searchParams.get("radius") || "1500"), 100), 50000);

    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return Response.json({ error: "Invalid coordinates" }, { status: 400 });
    }

    const apiKey = context.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Server not configured" }, { status: 503 });
    }

    const resp = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACE_FIELDS.map((f) => `places.${f}`).join(","),
      },
      body: JSON.stringify({
        includedTypes: ["restaurant"],
        maxResultCount: 20,
        rankPreference: "POPULARITY",
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius },
        },
      }),
    });

    if (!resp.ok) {
      console.error("Nearby search failed:", resp.status, await resp.text());
      return Response.json({ error: "Restaurant search failed" }, { status: 502 });
    }

    const data: any = await resp.json();
    const restaurants = (data.places || [])
      .map(mapPlace)
      .filter((r: RestaurantResult) => r.placeId && r.name && r.userRatingsTotal >= 5);

    return Response.json({ restaurants });
  } catch (err) {
    console.error("Nearby search error:", err);
    return Response.json({ error: "Failed to search nearby restaurants" }, { status: 500 });
  }
};
