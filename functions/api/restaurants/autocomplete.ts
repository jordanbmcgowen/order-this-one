interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const input = (url.searchParams.get("input") || "").trim();
    const lat = parseFloat(url.searchParams.get("lat") || "");
    const lng = parseFloat(url.searchParams.get("lng") || "");
    const session = url.searchParams.get("session");

    if (!input) {
      return Response.json({ predictions: [] });
    }

    const apiKey = context.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Server not configured" }, { status: 503 });
    }

    const body: Record<string, unknown> = {
      input,
      includedPrimaryTypes: ["restaurant"],
    };

    // Session token groups keystroke requests + the eventual details call into
    // one billed autocomplete session.
    if (session && /^[A-Za-z0-9-]{1,64}$/.test(session)) {
      body.sessionToken = session;
    }

    // Bias results toward the user's location if available.
    if (!isNaN(lat) && !isNaN(lng)) {
      body.locationBias = {
        circle: { center: { latitude: lat, longitude: lng }, radius: 50000 },
      };
    }

    const resp = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      console.error("Autocomplete failed:", resp.status, await resp.text());
      return Response.json({ error: "Search failed" }, { status: 502 });
    }

    const data: any = await resp.json();
    const predictions = (data.suggestions || [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({
        placeId: p.placeId,
        name: p.structuredFormat?.mainText?.text || p.text?.text || "",
        description: p.structuredFormat?.secondaryText?.text || "",
      }))
      .filter((p: any) => p.placeId && p.name);

    return Response.json({ predictions });
  } catch (err) {
    console.error("Autocomplete error:", err);
    return Response.json({ error: "Failed to search restaurants" }, { status: 500 });
  }
};
