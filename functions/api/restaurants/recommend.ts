interface Env {
  GOOGLE_MAPS_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  RECOMMENDATIONS: KVNamespace;
}

interface DishRecommendation {
  dishName: string;
  description: string;
  whyThisOne: string;
  priceRange: string;
  tags: string[];
  sources: string[];
  dishPhotos: string[];
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body: any = await context.request.json();
    const placeId = body.placeId;
    const restaurantName = body.restaurantName;

    if (!placeId || !restaurantName) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const apiKey = context.env.GOOGLE_MAPS_API_KEY;
    const anthropicKey = context.env.ANTHROPIC_API_KEY;

    // Check KV cache first
    const kv = context.env.RECOMMENDATIONS;
    if (kv) {
      const cached = await kv.get(placeId, "json");
      if (cached) {
        return Response.json({ recommendation: cached, cached: true });
      }
    }

    // Gather review data from multiple sources in parallel
    const [placeDetailsV1, placeDetailsLegacy, webResults] = await Promise.all([
      fetchPlaceDetailsV1(placeId, apiKey),
      fetchPlaceDetailsLegacy(placeId, apiKey),
      fetchWebInsights(restaurantName, apiKey),
    ]);

    // Combine all review data
    const allReviewTexts: string[] = [];
    const sources: string[] = [];

    if (placeDetailsV1.reviewSummary) {
      allReviewTexts.push(`[Google Review Summary - based on all ${placeDetailsV1.reviewCount || "many"} reviews] ${placeDetailsV1.reviewSummary}`);
      sources.push(`Google review summary (${placeDetailsV1.reviewCount || "many"} total reviews)`);
    }

    if (placeDetailsV1.editorialSummary) {
      allReviewTexts.push(`[Editorial Summary] ${placeDetailsV1.editorialSummary}`);
    }

    if (placeDetailsV1.reviews.length > 0) {
      for (const r of placeDetailsV1.reviews) {
        allReviewTexts.push(`[Google Review - ${r.rating}★] ${r.text}`);
      }
      sources.push(`${placeDetailsV1.reviews.length} Google reviews analyzed`);
    }

    if (placeDetailsLegacy.reviews.length > 0) {
      const existingTexts = new Set(allReviewTexts.map(t => t.slice(0, 100)));
      let addedCount = 0;
      for (const r of placeDetailsLegacy.reviews) {
        const formatted = `[Google Review - ${r.rating}★] ${r.text}`;
        if (!existingTexts.has(formatted.slice(0, 100))) {
          allReviewTexts.push(formatted);
          addedCount++;
        }
      }
      if (addedCount > 0 && !sources.some(s => s.includes("Google review"))) {
        sources.push(`${addedCount} additional Google reviews`);
      }
    }

    if (webResults.length > 0) {
      for (const result of webResults) {
        allReviewTexts.push(`[Web - ${result.source}] ${result.snippet}`);
      }
      const webSources = [...new Set(webResults.map(r => r.source))];
      sources.push(`Web research (${webSources.join(", ")})`);
    }

    const reviewContext = allReviewTexts.length > 0
      ? `Here is research data for ${restaurantName}:\n\n${allReviewTexts.join("\n\n")}`
      : `No review data available. Use your extensive knowledge of ${restaurantName} to make a recommendation.`;

    if (sources.length === 0) {
      sources.push("AI recommendation based on restaurant knowledge");
    }

    // Call Anthropic API to pick the dish
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `You are a food expert and dining critic. Your job is to identify THE ONE dish that someone absolutely must order at a restaurant. It should be the signature item, the thing that makes this place special, the dish people talk about.

Restaurant: ${restaurantName}

${reviewContext}

Based on ALL the data above (review summaries, individual reviews, web research, and your own knowledge), identify the single must-order dish. Consider:
- What dish is mentioned most frequently and positively across all sources?
- What seems truly unique or signature to this restaurant?
- What would a local food expert insist you try?
- What dish do reviewers specifically call out as a reason to visit?

Respond in this exact JSON format (no markdown, no code blocks, just raw JSON):
{
  "dishName": "The exact dish name",
  "description": "A mouth-watering 1-2 sentence description of the dish that makes someone want to order it immediately",
  "whyThisOne": "A brief, compelling reason why this is THE dish to order here (1-2 sentences)",
  "priceRange": "$ or $$ or $$$ or unknown",
  "tags": ["tag1", "tag2", "tag3"]
}

Tags should be 2-4 short descriptors like "signature", "spicy", "shareable", "must-try", "local favorite", "chef special", etc.

Important: Be specific. Don't say "their pasta" - say "Cacio e Pepe" or "Rigatoni Bolognese". Make the description vivid and appetizing. Keep all text concise and punchy.`,
          },
        ],
      }),
    });

    const anthropicData: any = await anthropicResponse.json();
    const responseText = anthropicData.content?.[0]?.text || "";

    let dishName: string;
    let description: string;
    let whyThisOne: string;
    let priceRange: string;
    let tags: string[];

    try {
      const parsed = JSON.parse(responseText);
      dishName = parsed.dishName || "Chef's Special";
      description = parsed.description || "A delicious signature dish.";
      whyThisOne = parsed.whyThisOne || "Highly recommended by locals and critics alike.";
      priceRange = parsed.priceRange || "$$";
      tags = parsed.tags || ["must-try"];
    } catch {
      dishName = "Chef's Signature Dish";
      description = "The standout item on the menu, crafted with care and consistently praised.";
      whyThisOne = "When in doubt, trust the chef's pride and joy.";
      priceRange = "$$";
      tags = ["must-try", "signature"];
    }

    // Now search for actual photos of this specific dish
    const dishPhotos = await searchDishPhotos(dishName, restaurantName, apiKey);

    const recommendation: DishRecommendation = {
      dishName,
      description,
      whyThisOne,
      priceRange,
      tags,
      sources,
      dishPhotos,
    };

    // Cache in KV (TTL: 7 days)
    if (kv) {
      await kv.put(placeId, JSON.stringify(recommendation), { expirationTtl: 604800 });
    }

    return Response.json({ recommendation, cached: false });
  } catch (err) {
    console.error("Recommendation error:", err);
    return Response.json({ error: "Failed to generate recommendation" }, { status: 500 });
  }
};

// ---- Dish photo search ----

async function searchDishPhotos(dishName: string, restaurantName: string, apiKey: string): Promise<string[]> {
  const photos: string[] = [];

  // Strategy 1: Google Custom Search JSON API (image search)
  // Uses the same Google Cloud project as Maps API
  // Search for "[dish] [restaurant]" to find photos from Yelp, food blogs, etc.
  try {
    const query = `${dishName} ${restaurantName} food`;
    const searchUrl = `https://customsearch.googleapis.com/customsearch/v1?key=${apiKey}&cx=YOUR_CX_HERE&q=${encodeURIComponent(query)}&searchType=image&num=6&imgType=photo&safe=active`;

    // Since Custom Search requires a separate CX (search engine ID),
    // we'll use an alternative: scrape Google Images thumbnails
    // via the standard search with tbm=isch parameter
    const googleImgUrl = `https://www.google.com/search?q=${encodeURIComponent(`${dishName} ${restaurantName}`)}&tbm=isch&ijn=0`;

    const resp = await fetch(googleImgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html",
      },
    });

    if (resp.ok) {
      const html = await resp.text();
      // Extract image URLs from Google Images HTML response
      // Google embeds image data in script tags as base64 or URLs
      const imgUrls = extractImageUrls(html);
      photos.push(...imgUrls.slice(0, 6));
    }
  } catch (e) {
    console.error("Google Images search error:", e);
  }

  // Strategy 2: Fallback to Places text search for food photos
  if (photos.length < 3 && apiKey) {
    try {
      const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.photos",
        },
        body: JSON.stringify({
          textQuery: `${dishName} at ${restaurantName}`,
          maxResultCount: 3,
        }),
      });

      const data: any = await resp.json();
      if (data.places) {
        for (const place of data.places) {
          for (const photo of (place.photos || []).slice(0, 3)) {
            if (photo.name) {
              // Convert Places v1 photo name to our proxy URL
              photos.push(`places-v1:${photo.name}`);
            }
          }
        }
      }
    } catch (e) {
      console.error("Places text search photo error:", e);
    }
  }

  return photos.slice(0, 6);
}

function extractImageUrls(html: string): string[] {
  const urls: string[] = [];

  // Method 1: Extract from data attributes and img tags
  // Google Images embeds thumbnails as data:image or https URLs
  const imgRegex = /\["(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)",\s*\d+,\s*\d+\]/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    // Skip Google's own assets, icons, and tiny images
    if (url && !url.includes("gstatic.com") && !url.includes("google.com/images") && !url.includes("googleusercontent.com/fakeurl")) {
      // Unescape the URL
      const cleanUrl = url.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\/g, "");
      urls.push(cleanUrl);
    }
  }

  // Method 2: Extract encrypted_tbn0 thumbnail URLs (these are Google-hosted thumbnails)
  const tbnRegex = /https:\/\/encrypted-tbn0\.gstatic\.com\/images\?q=tbn:[^"'\s]+/g;
  let tbnMatch;
  while ((tbnMatch = tbnRegex.exec(html)) !== null) {
    const url = tbnMatch[0].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\/g, "");
    if (!urls.includes(url)) {
      urls.push(url);
    }
  }

  return urls;
}

// ---- Review data fetching helpers ----

interface V1PlaceData {
  reviewSummary: string | null;
  editorialSummary: string | null;
  reviewCount: number | null;
  reviews: { rating: number; text: string }[];
  photoRefs: string[];
}

async function fetchPlaceDetailsV1(placeId: string, apiKey: string): Promise<V1PlaceData> {
  const empty: V1PlaceData = { reviewSummary: null, editorialSummary: null, reviewCount: null, reviews: [], photoRefs: [] };
  if (!apiKey) return empty;

  try {
    const resp = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "reviews,photos,editorialSummary,userRatingCount,reviewSummary",
        },
      }
    );
    const data: any = await resp.json();

    const reviews = (data.reviews || [])
      .map((r: any) => ({
        rating: r.rating || 0,
        text: r.text?.text || r.originalText?.text || "",
      }))
      .filter((r: any) => r.text.length > 30);

    const photoRefs = (data.photos || [])
      .slice(0, 10)
      .map((p: any) => p.name || "")
      .filter((n: string) => n.length > 0);

    return {
      reviewSummary: data.reviewSummary?.text?.text || null,
      editorialSummary: data.editorialSummary?.text || null,
      reviewCount: data.userRatingCount || null,
      reviews,
      photoRefs,
    };
  } catch (e) {
    console.error("V1 Place Details error:", e);
    return empty;
  }
}

interface LegacyPlaceData {
  reviews: { rating: number; text: string }[];
  photoRefs: string[];
}

async function fetchPlaceDetailsLegacy(placeId: string, apiKey: string): Promise<LegacyPlaceData> {
  const empty: LegacyPlaceData = { reviews: [], photoRefs: [] };
  if (!apiKey) return empty;

  try {
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,editorial_summary,photos&key=${apiKey}`;
    const resp = await fetch(detailsUrl);
    const data: any = await resp.json();

    const reviews = (data.result?.reviews || [])
      .map((r: any) => ({
        rating: r.rating || 0,
        text: r.text || "",
      }))
      .filter((r: any) => r.text.length > 30);

    const photoRefs = (data.result?.photos || [])
      .slice(0, 10)
      .map((p: any) => p.photo_reference || "")
      .filter((ref: string) => ref.length > 0);

    return { reviews, photoRefs };
  } catch (e) {
    console.error("Legacy Place Details error:", e);
    return empty;
  }
}

interface WebResult {
  source: string;
  snippet: string;
}

async function fetchWebInsights(restaurantName: string, apiKey: string): Promise<WebResult[]> {
  if (!apiKey) return [];

  try {
    const results: WebResult[] = [];
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.reviews,places.editorialSummary",
      },
      body: JSON.stringify({
        textQuery: `${restaurantName} best food must try`,
        maxResultCount: 3,
      }),
    });

    const data: any = await resp.json();

    if (data.places) {
      for (const place of data.places) {
        if (place.editorialSummary?.text) {
          results.push({
            source: "Google",
            snippet: place.editorialSummary.text,
          });
        }
        if (place.reviews) {
          for (const review of place.reviews.slice(0, 3)) {
            const text = review.text?.text || review.originalText?.text || "";
            if (text.length > 50) {
              results.push({
                source: "Google",
                snippet: `[${review.rating}★] ${text}`,
              });
            }
          }
        }
      }
    }

    return results.slice(0, 10);
  } catch (e) {
    console.error("Web insights error:", e);
    return [];
  }
}
