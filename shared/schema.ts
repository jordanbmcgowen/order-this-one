import { z } from "zod";

// API request/response types
export const nearbySearchSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  radius: z.number().optional().default(1000),
});

export const recommendationRequestSchema = z.object({
  placeId: z.string(),
  restaurantName: z.string(),
});

export type NearbySearchRequest = z.infer<typeof nearbySearchSchema>;
export type RecommendationRequest = z.infer<typeof recommendationRequestSchema>;

export interface RestaurantResult {
  placeId: string;
  name: string;
  vicinity: string;
  rating: number;
  userRatingsTotal: number;
  priceLevel: number;
  photoRef: string | null;
  lat: number;
  lng: number;
  openNow: boolean | null;
  types: string[];
}

export interface DishRecommendation {
  dishName: string;
  description: string;
  whyThisOne: string;
  priceRange: string;
  tags: string[];
  sources: string[];
}
