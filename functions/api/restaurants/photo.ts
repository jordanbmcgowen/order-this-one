interface Env {
  GOOGLE_MAPS_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const photoRef = url.searchParams.get("ref");
    const photoName = url.searchParams.get("name");
    const externalUrl = url.searchParams.get("url");
    const apiKey = context.env.GOOGLE_MAPS_API_KEY;

    let photoUrl: string;

    if (externalUrl) {
      // Proxy an external image URL (dish photos from Google Images, etc.)
      // Only allow image URLs from known safe domains
      const allowed = [
        "encrypted-tbn0.gstatic.com",
        "lh3.googleusercontent.com",
        "lh4.googleusercontent.com",
        "lh5.googleusercontent.com",
        "s3-media",
        "yelp.com",
        "yelpcdn.com",
        "cloudfront.net",
        "tripadvisor.com",
        "tripadvisorcdn.com",
      ];
      const extHostname = new URL(externalUrl).hostname;
      const isAllowed = allowed.some(d => extHostname.includes(d));
      if (!isAllowed) {
        // For other domains, still proxy but with a stricter check
        // Accept any HTTPS image URL
        if (!externalUrl.startsWith("https://")) {
          return Response.json({ error: "Only HTTPS URLs allowed" }, { status: 400 });
        }
      }
      photoUrl = externalUrl;
    } else if (photoName && apiKey) {
      // Places API v1 (New) photo
      photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${apiKey}`;
    } else if (photoRef && apiKey) {
      // Legacy Places API photo reference
      photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${apiKey}`;
    } else {
      return Response.json({ error: "Missing photo reference" }, { status: 400 });
    }

    const response = await fetch(photoUrl, { redirect: "follow" });

    if (!response.ok) {
      return Response.json({ error: "Failed to fetch photo" }, { status: response.status });
    }

    const contentType = response.headers.get("content-type") || "";
    // Verify we actually got an image back
    if (!contentType.startsWith("image/")) {
      return Response.json({ error: "Not an image" }, { status: 400 });
    }

    const buffer = await response.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return Response.json({ error: "Failed to fetch photo" }, { status: 500 });
  }
};
