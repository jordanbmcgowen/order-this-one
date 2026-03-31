interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const lat = parseFloat(url.searchParams.get("lat") || "");
    const lng = parseFloat(url.searchParams.get("lng") || "");
    const radius = parseInt(url.searchParams.get("radius") || "1000");

    if (isNaN(lat) || isNaN(lng)) {
      return Response.json({ error: "Invalid coordinates" }, { status: 400 });
    }

    const apiKey = context.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Google Maps API key not configured" }, { status: 400 });
    }

    const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=restaurant&key=${apiKey}&rankby=prominence`;

    const response = await fetch(placesUrl);
    const data: any = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return Response.json({ error: `Places API: ${data.status}` }, { status: 400 });
    }

    const restaurants = (data.results || [])
      .filter((r: any) => r.rating && r.user_ratings_total > 10)
      .map((r: any) => ({
        placeId: r.place_id,
        name: r.name,
        vicinity: r.vicinity,
        rating: r.rating,
        userRatingsTotal: r.user_ratings_total,
        priceLevel: r.price_level || 0,
        photoRef: r.photos?.[0]?.photo_reference || null,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        openNow: r.opening_hours?.open_now ?? null,
        types: r.types || [],
      }));

    return Response.json({ restaurants });
  } catch (err) {
    console.error("Nearby search error:", err);
    return Response.json({ error: "Failed to search nearby restaurants" }, { status: 500 });
  }
};
