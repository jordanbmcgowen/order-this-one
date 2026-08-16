import { feedbackRequestSchema } from "../../../shared/schema";
import type { FeedbackCounts } from "../../../shared/schema";

interface Env {
  RECOMMENDATIONS: KVNamespace;
}

interface DishFeedback {
  [dishName: string]: FeedbackCounts;
}

const feedbackKey = (placeId: string) => `fb:v1:${placeId}`;

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
