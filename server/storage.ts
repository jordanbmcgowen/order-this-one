import { type Recommendation, type InsertRecommendation, recommendations } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export interface IStorage {
  getRecommendation(placeId: string): Promise<Recommendation | undefined>;
  createRecommendation(rec: InsertRecommendation): Promise<Recommendation>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Create table if not exists
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        place_id TEXT NOT NULL,
        restaurant_name TEXT NOT NULL,
        dish_name TEXT NOT NULL,
        description TEXT NOT NULL,
        why_this_one TEXT NOT NULL,
        price_range TEXT,
        tags TEXT,
        created_at TEXT NOT NULL
      )
    `);
  }

  async getRecommendation(placeId: string): Promise<Recommendation | undefined> {
    return db.select().from(recommendations).where(eq(recommendations.placeId, placeId)).get();
  }

  async createRecommendation(rec: InsertRecommendation): Promise<Recommendation> {
    return db.insert(recommendations).values(rec).returning().get();
  }
}

export const storage = new DatabaseStorage();
