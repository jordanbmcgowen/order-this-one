interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const placeId = url.searchParams.get("placeId");

    if (!placeId) {
      return Response.json({ error: "Missing placeId" }, { status: 400 });
    }

    const apiKey = context.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Google Maps API key not configured" }, { status: 400 });
    }

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=place_id,name,vicinity,formatted_address,rating,user_ratings_total,price_level,photos,geometry,opening_hours,types&key=${apiKey}`;

    const response = await fetch(detailsUrl);
    const data: any = await response.json();

    if (data.status !== "OK" || !data.result) {
      return Response.json({ error: `Place Details API: ${data.status}` }, { status: 400 });
    }

    const r = data.result;
    const restaurant = {
      placeId: r.place_id,
      name: r.name,
      vicinity: r.vicinity || r.formatted_address || "",
      rating: r.rating || 0,
      userRatingsTotal: r.user_ratings_total || 0,
      priceLevel: r.price_level || 0,
      photoRef: r.photos?.[0]?.photo_reference || null,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      openNow: r.opening_hours?.open_now ?? null,
      types: r.types || [],
    };

    return Response.json({ restaurant });
  } catch (err) {
    console.error("Place details error:", err);
    return Response.json({ error: "Failed to get restaurant details" }, { status: 500 });
  }
};
