import { feedbackRequestSchema } from "../../../shared/schema";
import type { DishRecommendation } from "../../../shared/schema";
import { recKey, feedbackKey, type DishFeedback } from "./recommend";

interface Env {
  RECOMMENDATIONS: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = feedbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const kv = context.env.RECOMMENDATIONS;
  if (!kv) {
    return Response.json({ error: "Server not configured" }, { status: 503 });
  }

  const { placeId, dishName, vote } = parsed.data;
  const dish = dishName.toLowerCase();

  try {
    // Votes are only accepted for the dish this place's live recommendation
    // actually names. This anchors feedback KV usage to real recommendations
    // (no unbounded keys or attacker-chosen dish strings, which would
    // otherwise flow into a future research prompt).
    const cached = await kv.get<DishRecommendation>(recKey(placeId), "json");
    if (!cached) {
      return Response.json({ error: "No recommendation to rate" }, { status: 404 });
    }
    if (cached.dishName.toLowerCase() !== dish) {
      return Response.json({ error: "Feedback must be for the current recommendation" }, { status: 400 });
    }

    // Note: KV has no atomic increment, so near-simultaneous votes can clobber
    // each other. Feedback is an advisory regeneration signal, not an exact
    // tally, so last-write-wins is an accepted tradeoff here.
    const key = feedbackKey(placeId);
    const existing = (await kv.get<DishFeedback>(key, "json")) || {};
    const counts = existing[dish] || { up: 0, down: 0 };
    if (vote === "up") counts.up += 1;
    else counts.down += 1;
    existing[dish] = counts;

    // Feedback informs future regenerations; keep it around for 90 days.
    await kv.put(key, JSON.stringify(existing), { expirationTtl: 90 * 24 * 3600 });

    return Response.json({ ok: true, counts });
  } catch (err) {
    console.error("Feedback error:", err);
    return Response.json({ error: "Failed to record feedback" }, { status: 500 });
  }
};
