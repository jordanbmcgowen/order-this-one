interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

// Proxies Google Places (New) photos so the Maps API key never reaches the
// browser. Only Places photo resource names are accepted — this is not a
// general-purpose image proxy.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const photoName = url.searchParams.get("name");
    const apiKey = context.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return Response.json({ error: "Server not configured" }, { status: 503 });
    }

    // Places photo names look like: places/{placeId}/photos/{photoId}
    if (!photoName || !/^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
      return Response.json({ error: "Invalid photo reference" }, { status: 400 });
    }

    const photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${apiKey}`;
    const response = await fetch(photoUrl, { redirect: "follow" });

    if (!response.ok) {
      return Response.json({ error: "Failed to fetch photo" }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return Response.json({ error: "Not an image" }, { status: 502 });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return Response.json({ error: "Failed to fetch photo" }, { status: 500 });
  }
};
