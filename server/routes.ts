import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { nearbySearchSchema, recommendationRequestSchema } from "@shared/schema";
import type { RestaurantResult, DishRecommendation } from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Nearby restaurant search via Google Places
  app.get("/api/restaurants/nearby", async (req, res) => {
    try {
      const parsed = nearbySearchSchema.safeParse({
        lat: parseFloat(req.query.lat as string),
        lng: parseFloat(req.query.lng as string),
        radius: req.query.radius ? parseInt(req.query.radius as string) : 1000,
      });

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid coordinates" });
      }

      const { lat, lng, radius } = parsed.data;

      if (!GOOGLE_API_KEY) {
        return res.status(400).json({ error: "Google Maps API key not configured" });
      }

      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=restaurant&key=${GOOGLE_API_KEY}&rankby=prominence`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        console.error("Places API error:", data.status, data.error_message);
        return res.status(400).json({ error: `Places API: ${data.status}` });
      }

      const restaurants: RestaurantResult[] = (data.results || [])
        .filter((r: any) => r.rating && r.user_ratings_total > 10)
        .map((r: any) => ({
          placeId: r.place_id,
          name: r.name,
          vicinity: r.vicinity,
          rating: r.rating,
          userRatingsTotal: r.user_ratings_total,
          priceLevel: r.price_level || 0,
          photoRef: r.photos?.[0]?.photo_reference || null,
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          openNow: r.opening_hours?.open_now ?? null,
          types: r.types || [],
        }));

      res.json({ restaurants });
    } catch (err: any) {
      console.error("Nearby search error:", err);
      res.status(500).json({ error: "Failed to search nearby restaurants" });
    }
  });

  // Get photo URL proxy for Google Places photos
  app.get("/api/restaurants/photo", async (req, res) => {
    try {
      const photoRef = req.query.ref as string;
      if (!photoRef || !GOOGLE_API_KEY) {
        return res.status(400).json({ error: "Missing photo reference" });
      }
      const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${GOOGLE_API_KEY}`;
      const response = await fetch(url, { redirect: "follow" });
      const buffer = Buffer.from(await response.arrayBuffer());
      res.set("Content-Type", response.headers.get("content-type") || "image/jpeg");
      res.set("Cache-Control", "public, max-age=86400");
      res.send(buffer);
    } catch {
      res.status(500).json({ error: "Failed to fetch photo" });
    }
  });

  // Get recommendation for a specific restaurant
  app.post("/api/restaurants/recommend", async (req, res) => {
    try {
      const parsed = recommendationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request" });
      }

      const { placeId, restaurantName } = parsed.data;

      // Check cache first
      const cached = await storage.getRecommendation(placeId);
      if (cached) {
        const recommendation: DishRecommendation = {
          dishName: cached.dishName,
          description: cached.description,
          whyThisOne: cached.whyThisOne,
          priceRange: cached.priceRange || "",
          tags: cached.tags ? JSON.parse(cached.tags) : [],
          sources: ["Cached recommendation"],
        };
        return res.json({ recommendation, cached: true });
      }

      // Get Google Reviews via Place Details
      let googleReviews: string[] = [];
      if (GOOGLE_API_KEY) {
        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,editorial_summary&key=${GOOGLE_API_KEY}`;
        const detailsResp = await fetch(detailsUrl);
        const detailsData = await detailsResp.json();
        if (detailsData.result?.reviews) {
          googleReviews = detailsData.result.reviews
            .map((r: any) => `[Google Review - ${r.rating}★] ${r.text}`)
            .filter((r: string) => r.length > 50);
        }
      }

      // Use Anthropic to analyze reviews and determine the must-order dish
      const anthropic = new Anthropic();

      const reviewContext = googleReviews.length > 0
        ? `Here are Google Reviews for ${restaurantName}:\n\n${googleReviews.join("\n\n")}`
        : `No reviews available. Use your knowledge of ${restaurantName} to make a recommendation.`;

      const message = await anthropic.messages.create({
        model: "claude_sonnet_4_6",
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
      });

      // Parse the LLM response
      const responseText = message.content[0].type === "text" ? message.content[0].text : "";

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

      // Cache the recommendation
      await storage.createRecommendation({
        placeId,
        restaurantName,
        dishName: recommendation.dishName,
        description: recommendation.description,
        whyThisOne: recommendation.whyThisOne,
        priceRange: recommendation.priceRange,
        tags: JSON.stringify(recommendation.tags),
        createdAt: new Date().toISOString(),
      });

      res.json({ recommendation, cached: false });
    } catch (err: any) {
      console.error("Recommendation error:", err);
      res.status(500).json({ error: "Failed to generate recommendation" });
    }
  });

  return httpServer;
}
