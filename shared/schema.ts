import { z } from "zod";

// ---- API request schemas ----

export const nearbySearchSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius: z.number().min(100).max(50000).optional().default(1500),
});

export const recommendationRequestSchema = z.object({
  placeId: z.string().min(1).max(512),
});

export const feedbackRequestSchema = z.object({
  placeId: z.string().min(1).max(512),
  dishName: z.string().min(1).max(200),
  vote: z.enum(["up", "down"]),
});

export type NearbySearchRequest = z.infer<typeof nearbySearchSchema>;
export type RecommendationRequest = z.infer<typeof recommendationRequestSchema>;
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

// ---- API response types ----

export interface RestaurantResult {
  placeId: string;
  name: string;
  vicinity: string;
  rating: number;
  userRatingsTotal: number;
  priceLevel: number; // 0 = unknown, 1-4 = $ to $$$$
  photoName: string | null; // Places API (New) photo resource name
  lat: number;
  lng: number;
  openNow: boolean | null;
  types: string[];
}

export type Confidence = "high" | "medium" | "low";

export interface EvidenceQuote {
  quote: string;
  source: string; // e.g. "Google review", "Reddit r/FoodNYC", "Eater Dallas"
}

export interface Citation {
  title: string;
  url: string;
}

export interface RunnerUp {
  dishName: string;
  note: string;
}

export interface DishRecommendation {
  version: number;
  dishName: string;
  description: string;
  whyThisOne: string;
  priceRange: string; // "$" | "$$" | "$$$" | "unknown"
  tags: string[];
  confidence: Confidence;
  confidenceReason: string;
  evidence: EvidenceQuote[];
  citations: Citation[];
  runnersUp: RunnerUp[];
  photoNames: string[]; // Places API (New) photo resource names for the restaurant
  generatedAt: string; // ISO timestamp
}

export interface FeedbackCounts {
  up: number;
  down: number;
}
