interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const address = (url.searchParams.get("address") || "").trim();
    const apiKey = context.env.GOOGLE_MAPS_API_KEY;

    if (!address) {
      return Response.json({ error: "Missing address" }, { status: 400 });
    }
    if (!apiKey) {
      return Response.json({ error: "Server not configured" }, { status: 503 });
    }

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(geocodeUrl);
    const data: any = await response.json();

    if (data.status === "ZERO_RESULTS" || (data.status === "OK" && !data.results?.length)) {
      return Response.json({ error: "Could not find that location" }, { status: 404 });
    }
    if (data.status !== "OK") {
      // REQUEST_DENIED / OVER_QUERY_LIMIT / etc. are upstream problems, not a
      // bad address.
      console.error("Geocoding failed:", data.status, data.error_message);
      return Response.json({ error: "Location lookup unavailable" }, { status: 502 });
    }

    const loc = data.results[0].geometry.location;
    return Response.json({
      lat: loc.lat,
      lng: loc.lng,
      formatted: data.results[0].formatted_address,
    });
  } catch {
    return Response.json({ error: "Geocoding failed" }, { status: 500 });
  }
};
