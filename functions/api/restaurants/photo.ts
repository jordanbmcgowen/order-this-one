interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const photoRef = url.searchParams.get("ref");
    const photoName = url.searchParams.get("name");
    const apiKey = context.env.GOOGLE_MAPS_API_KEY;

    if ((!photoRef && !photoName) || !apiKey) {
      return Response.json({ error: "Missing photo reference" }, { status: 400 });
    }

    let photoUrl: string;

    if (photoName) {
      // Places API v1 (New) photo - name is like "places/PLACE_ID/photos/PHOTO_REF"
      photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${apiKey}`;
    } else {
      // Legacy Places API photo reference
      photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${apiKey}`;
    }

    const response = await fetch(photoUrl, { redirect: "follow" });
    const buffer = await response.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return Response.json({ error: "Failed to fetch photo" }, { status: 500 });
  }
};
