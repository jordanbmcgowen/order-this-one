import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Store past recommendations for quick retrieval
export const recommendations = sqliteTable("recommendations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  placeId: text("place_id").notNull(),
  restaurantName: text("restaurant_name").notNull(),
  dishName: text("dish_name").notNull(),
  description: text("description").notNull(),
  whyThisOne: text("why_this_one").notNull(),
  priceRange: text("price_range"),
  tags: text("tags"), // JSON array stored as text
  createdAt: text("created_at").notNull(),
});

export const insertRecommendationSchema = createInsertSchema(recommendations).omit({
  id: true,
});

export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type Recommendation = typeof recommendations.$inferSelect;

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
