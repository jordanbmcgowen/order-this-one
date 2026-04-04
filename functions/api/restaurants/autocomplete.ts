interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const input = url.searchParams.get("input") || "";
    const lat = url.searchParams.get("lat");
    const lng = url.searchParams.get("lng");

    if (!input.trim()) {
      return Response.json({ predictions: [] });
    }

    const apiKey = context.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Google Maps API key not configured" }, { status: 400 });
    }

    let autocompleteUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=restaurant&key=${apiKey}`;

    // Bias results toward user's location if available
    if (lat && lng) {
      autocompleteUrl += `&location=${lat},${lng}&radius=50000`;
    }

    const response = await fetch(autocompleteUrl);
    const data: any = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return Response.json({ error: `Autocomplete API: ${data.status}` }, { status: 400 });
    }

    const predictions = (data.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      name: p.structured_formatting?.main_text || p.description,
      description: p.structured_formatting?.secondary_text || "",
    }));

    return Response.json({ predictions });
  } catch (err) {
    console.error("Autocomplete error:", err);
    return Response.json({ error: "Failed to search restaurants" }, { status: 500 });
  }
};
