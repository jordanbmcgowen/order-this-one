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

    // Get Google Reviews via Place Details
    let googleReviews: string[] = [];
    if (apiKey) {
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,editorial_summary&key=${apiKey}`;
      const detailsResp = await fetch(detailsUrl);
      const detailsData: any = await detailsResp.json();
      if (detailsData.result?.reviews) {
        googleReviews = detailsData.result.reviews
          .map((r: any) => `[Google Review - ${r.rating}★] ${r.text}`)
          .filter((r: string) => r.length > 50);
      }
    }

    // Call Anthropic API directly
    const reviewContext = googleReviews.length > 0
      ? `Here are Google Reviews for ${restaurantName}:\n\n${googleReviews.join("\n\n")}`
      : `No reviews available. Use your knowledge of ${restaurantName} to make a recommendation.`;

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

Based on the reviews and your knowledge of this restaurant, identify the single must-order dish. Consider:
- What dish is mentioned most positively in reviews?
- What seems unique or signature to this restaurant?
- What would a local food expert recommend?

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

    let recommendation: DishRecommendation;
    try {
      const parsed = JSON.parse(responseText);
      recommendation = {
        dishName: parsed.dishName || "Chef's Special",
        description: parsed.description || "A delicious signature dish.",
        whyThisOne: parsed.whyThisOne || "Highly recommended by locals and critics alike.",
        priceRange: parsed.priceRange || "$$",
        tags: parsed.tags || ["must-try"],
        sources: googleReviews.length > 0
          ? [`${googleReviews.length} Google Reviews analyzed`]
          : ["AI recommendation based on restaurant knowledge"],
      };
    } catch {
      recommendation = {
        dishName: "Chef's Signature Dish",
        description: "The standout item on the menu, crafted with care and consistently praised.",
        whyThisOne: "When in doubt, trust the chef's pride and joy.",
        priceRange: "$$",
        tags: ["must-try", "signature"],
        sources: ["AI recommendation"],
      };
    }

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
