import { mapPlace, PLACE_FIELDS } from "./nearby";

interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const placeId = url.searchParams.get("placeId");
    const session = url.searchParams.get("session");

    if (!placeId || !/^[A-Za-z0-9_-]{4,512}$/.test(placeId)) {
      return Response.json({ error: "Invalid placeId" }, { status: 400 });
    }

    const apiKey = context.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Server not configured" }, { status: 503 });
    }

    // Closing the autocomplete session here groups the keystroke requests and
    // this details call into one billed session on Google's side.
    let detailsUrl = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
    if (session && /^[A-Za-z0-9-]{1,64}$/.test(session)) {
      detailsUrl += `?sessionToken=${encodeURIComponent(session)}`;
    }

    const resp = await fetch(detailsUrl, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACE_FIELDS.join(","),
      },
    });

    // 404 = unknown ID; 400 = malformed ID — both are "not found" to clients.
    if (resp.status === 404 || resp.status === 400) {
      return Response.json({ error: "Restaurant not found" }, { status: 404 });
    }
    if (!resp.ok) {
      console.error("Place details failed:", resp.status, await resp.text());
      return Response.json({ error: "Failed to get restaurant details" }, { status: 502 });
    }

    const data: any = await resp.json();
    const restaurant = mapPlace(data);
    if (!restaurant.placeId || !restaurant.name) {
      return Response.json({ error: "Restaurant not found" }, { status: 404 });
    }

    return Response.json({ restaurant });
  } catch (err) {
    console.error("Place details error:", err);
    return Response.json({ error: "Failed to get restaurant details" }, { status: 500 });
  }
};
