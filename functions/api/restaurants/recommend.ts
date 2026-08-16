import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { recommendationRequestSchema } from "../../../shared/schema";
import type { DishRecommendation, FeedbackCounts } from "../../../shared/schema";

interface Env {
  GOOGLE_MAPS_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  RECOMMENDATIONS: KVNamespace;
}

const REC_VERSION = 2;
const recKey = (placeId: string) => `rec:v${REC_VERSION}:${placeId}`;
const feedbackKey = (placeId: string) => `fb:v1:${placeId}`;

// Confidence-weighted cache lifetimes: strong evidence keeps longer, weak
// evidence gets retried sooner so the database self-corrects.
const TTL_BY_CONFIDENCE: Record<string, number> = {
  high: 30 * 24 * 3600,
  medium: 14 * 24 * 3600,
  low: 3 * 24 * 3600,
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = recommendationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { placeId } = parsed.data;

  const { GOOGLE_MAPS_API_KEY: mapsKey, ANTHROPIC_API_KEY: anthropicKey, RECOMMENDATIONS: kv } = context.env;
  if (!mapsKey || !anthropicKey) {
    return Response.json({ error: "Server not configured" }, { status: 503 });
  }

  try {
    const feedback = kv ? await readFeedback(kv, placeId) : null;

    // Serve from cache unless user feedback says the cached pick is wrong.
    if (kv) {
      const cached = await kv.get<DishRecommendation>(recKey(placeId), "json");
      if (cached && !isDiscredited(cached.dishName, feedback)) {
        return Response.json({ recommendation: cached, cached: true });
      }
    }

    const place = await fetchPlaceDetails(placeId, mapsKey);
    if (!place) {
      return Response.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const recommendation = await generateRecommendation(anthropicKey, place, feedback);
    recommendation.photoNames = place.photoNames;

    if (kv) {
      const ttl = TTL_BY_CONFIDENCE[recommendation.confidence] ?? TTL_BY_CONFIDENCE.low;
      await kv.put(recKey(placeId), JSON.stringify(recommendation), { expirationTtl: ttl });
    }

    return Response.json({ recommendation, cached: false });
  } catch (err) {
    console.error("Recommendation error:", err);
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: "Recommendation engine unavailable, try again shortly" }, { status: 502 });
    }
    return Response.json({ error: "Failed to generate recommendation" }, { status: 500 });
  }
};

// ---- Feedback ----

interface DishFeedback {
  [dishName: string]: FeedbackCounts;
}

async function readFeedback(kv: KVNamespace, placeId: string): Promise<DishFeedback | null> {
  try {
    return await kv.get<DishFeedback>(feedbackKey(placeId), "json");
  } catch {
    return null;
  }
}

// A cached pick is discredited when real users have clearly voted it down.
function isDiscredited(dishName: string, feedback: DishFeedback | null): boolean {
  if (!feedback) return false;
  const counts = feedback[dishName.toLowerCase()];
  if (!counts) return false;
  return counts.down >= 3 && counts.down > counts.up;
}

// ---- Google Places (New) research input ----

interface PlaceEvidence {
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: string | null;
  reviewSummary: string | null;
  editorialSummary: string | null;
  reviews: { rating: number; text: string }[];
  photoNames: string[];
}

async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<PlaceEvidence | null> {
  const fieldMask = [
    "id",
    "displayName",
    "formattedAddress",
    "rating",
    "userRatingCount",
    "priceLevel",
    "reviews",
    "reviewSummary",
    "editorialSummary",
    "photos",
  ].join(",");

  const resp = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
  });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`Place Details failed: ${resp.status} ${await resp.text()}`);
  }

  const data: any = await resp.json();
  if (!data.displayName?.text) return null;

  const reviews = (data.reviews || [])
    .map((r: any) => ({
      rating: r.rating || 0,
      text: r.text?.text || r.originalText?.text || "",
    }))
    .filter((r: { text: string }) => r.text.length > 30);

  return {
    name: data.displayName.text,
    address: data.formattedAddress || "",
    rating: data.rating ?? null,
    reviewCount: data.userRatingCount ?? null,
    priceLevel: data.priceLevel ?? null,
    reviewSummary: data.reviewSummary?.text?.text || null,
    editorialSummary: data.editorialSummary?.text || null,
    reviews,
    photoNames: (data.photos || [])
      .map((p: any) => p.name || "")
      .filter((n: string) => n.length > 0)
      .slice(0, 6),
  };
}

// ---- Claude research + recommendation ----

// Shape/type validation only — sizes are clamped in finalizeRecommendation
// rather than rejected, so an over-eager model answer degrades instead of 500ing.
const toolInputSchema = z.object({
  dishName: z.string().min(1),
  description: z.string().min(1),
  whyThisOne: z.string().min(1),
  priceRange: z.enum(["$", "$$", "$$$", "$$$$", "unknown"]),
  tags: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  confidenceReason: z.string().min(1),
  evidence: z.array(z.object({ quote: z.string(), source: z.string() })),
  citations: z.array(z.object({ title: z.string(), url: z.string() })),
  runnersUp: z.array(z.object({ dishName: z.string(), note: z.string() })),
});

const RECOMMENDATION_TOOL: Anthropic.Beta.BetaTool = {
  name: "record_recommendation",
  description:
    "Record your final, evidence-backed recommendation for the single best dish to order at this restaurant. Call this exactly once, after you have finished researching.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "dishName",
      "description",
      "whyThisOne",
      "priceRange",
      "tags",
      "confidence",
      "confidenceReason",
      "evidence",
      "citations",
      "runnersUp",
    ],
    properties: {
      dishName: {
        type: "string",
        description: "The exact name of the single must-order dish, as it appears on the menu or in reviews.",
      },
      description: {
        type: "string",
        description: "A vivid 1-2 sentence description of the dish grounded in what sources actually say about it.",
      },
      whyThisOne: {
        type: "string",
        description:
          "1-2 sentences on why this specific dish is THE one, referencing the strength of the evidence (e.g. how many independent sources named it).",
      },
      priceRange: {
        type: "string",
        enum: ["$", "$$", "$$$", "$$$$", "unknown"],
        description: "Approximate price tier of the dish/restaurant. Use 'unknown' if you found no pricing signal.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "2-4 short descriptors, e.g. 'signature', 'spicy', 'shareable', 'local favorite'.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "high = 3+ independent sources converge on this dish; medium = clear signal from one or two source types; low = thin evidence, best-effort pick.",
      },
      confidenceReason: {
        type: "string",
        description: "One sentence explaining the confidence level, e.g. 'Named in 14 Google reviews, a Reddit thread, and an Eater guide'.",
      },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["quote", "source"],
          properties: {
            quote: { type: "string", description: "A short VERBATIM quote from a review or article mentioning the dish." },
            source: { type: "string", description: "Where the quote is from, e.g. 'Google review', 'Reddit', 'Eater'." },
          },
        },
        description: "2-4 of the strongest verbatim quotes supporting this pick. Never invent or paraphrase quotes.",
      },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url"],
          properties: {
            title: { type: "string" },
            url: { type: "string", description: "Real URL from your web search results. Never fabricate URLs." },
          },
        },
        description: "Web pages you actually consulted via search that informed this pick. Empty if none.",
      },
      runnersUp: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["dishName", "note"],
          properties: {
            dishName: { type: "string" },
            note: { type: "string", description: "One short sentence on why it's a strong contender but not the pick." },
          },
        },
        description: "0-2 dishes that were serious contenders. Helps users trust the process.",
      },
    },
  },
};

const SYSTEM_PROMPT = `You are the research engine behind "Order This One", a service whose entire promise is naming the single best item to order at any restaurant in America — accurately. Users make real dining decisions from your answer, so accuracy beats flair.

## Method

1. Read the Google Places data provided (aggregated review summary, editorial summary, individual reviews). Extract every dish mentioned positively and tally roughly how often each comes up.
2. Research the wider web with the web_search tool. Useful angles: "<restaurant> <city> best thing to order", "<restaurant> reddit what to order", and coverage from local food press (Eater, The Infatuation, local newspapers) or Yelp/TripAdvisor discussion. Search enough to cross-check the leading candidates — typically 2-4 searches. Include the city in queries and confirm results are about THIS restaurant at THIS address, not a same-named place elsewhere.
3. Converge: the winning dish is the one independent sources agree on. Frequency of specific, enthusiastic mentions beats a single glowing mention. A true signature (a dish the restaurant is known for) beats a generically praised one.

## Evidence rules — non-negotiable

- Only recommend a dish you have actually seen evidenced for this restaurant. Never invent a plausible-sounding dish, and never fall back to "Chef's Special".
- Quotes in "evidence" must be verbatim from the provided reviews or from pages you found via search. If you can't quote it, don't claim it.
- Citations must be real URLs from your search results. If you did no useful web research, return an empty citations list.
- Be honest in "confidence". A low-evidence pick with confidence "low" and a frank confidenceReason is a good answer; inflated confidence is a wrong answer.
- Be specific: "Cacio e Pepe", not "their pasta".

When your research is complete, call record_recommendation exactly once with your final answer. Keep all text fields concise and punchy.`;

async function generateRecommendation(
  anthropicKey: string,
  place: PlaceEvidence,
  feedback: DishFeedback | null,
): Promise<DishRecommendation> {
  const client = new Anthropic({ apiKey: anthropicKey });

  const model = "claude-opus-5";
  const userPrompt = buildUserPrompt(place, feedback);

  const baseParams = {
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-06-01"] as string[],
    fallbacks: [{ model: "claude-opus-4-8" as const }],
    system: [
      {
        type: "text" as const,
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    tools: [
      { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 6 },
      RECOMMENDATION_TOOL,
    ],
  };

  let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userPrompt }];
  let nudged = false;

  // Server-side web search runs inside a single request; we only need to loop
  // for pause_turn continuations and one "call the tool" nudge.
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await client.beta.messages.create({ ...baseParams, messages });

    if (response.stop_reason === "refusal") {
      throw new Error("Model declined the request");
    }

    if (response.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use" && block.name === "record_recommendation",
    );

    if (toolUse) {
      return finalizeRecommendation(toolUse.input);
    }

    // Finished talking without recording an answer — nudge once.
    if (!nudged) {
      nudged = true;
      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: "Record your final answer now by calling the record_recommendation tool." },
      ];
      continue;
    }

    break;
  }

  throw new Error("Model did not produce a recommendation");
}

function buildUserPrompt(place: PlaceEvidence, feedback: DishFeedback | null): string {
  const lines: string[] = [];
  lines.push(`Restaurant: ${place.name}`);
  lines.push(`Address: ${place.address}`);
  if (place.rating != null && place.reviewCount != null) {
    lines.push(`Google rating: ${place.rating} (${place.reviewCount} reviews)`);
  }
  if (place.priceLevel) lines.push(`Price level: ${place.priceLevel}`);
  lines.push("");

  if (place.reviewSummary) {
    lines.push(`Google's AI summary of all reviews:\n${place.reviewSummary}\n`);
  }
  if (place.editorialSummary) {
    lines.push(`Editorial summary: ${place.editorialSummary}\n`);
  }
  if (place.reviews.length > 0) {
    lines.push("Individual Google reviews:");
    for (const r of place.reviews) {
      lines.push(`[${r.rating}/5] ${r.text}`);
    }
    lines.push("");
  }
  if (place.reviews.length === 0 && !place.reviewSummary) {
    lines.push("No Google review data is available — web research is your only evidence source. If the web has nothing either, pick the best-evidenced option you can find and mark confidence low.");
    lines.push("");
  }

  const downvoted = feedback
    ? Object.entries(feedback)
        .filter(([, counts]) => counts.down >= 3 && counts.down > counts.up)
        .map(([dish]) => dish)
    : [];
  if (downvoted.length > 0) {
    lines.push(
      `User feedback: previous recommendation(s) of ${downvoted.join(", ")} received repeated thumbs-down from diners at this restaurant. Weigh that seriously — either find stronger evidence for a different dish, or only re-recommend one of these if the evidence is overwhelming.`,
    );
    lines.push("");
  }

  lines.push("Find the single best item to order here.");
  return lines.join("\n");
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function finalizeRecommendation(rawInput: unknown): DishRecommendation {
  const parsed = toolInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(`Tool output failed validation: ${parsed.error.message}`);
  }
  const input = parsed.data;

  const citations = input.citations
    .filter((c) => {
      try {
        return new URL(c.url).protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 8)
    .map((c) => ({ title: clip(c.title.trim() || c.url, 200), url: c.url }));

  return {
    version: REC_VERSION,
    dishName: clip(input.dishName, 200),
    description: clip(input.description, 600),
    whyThisOne: clip(input.whyThisOne, 600),
    priceRange: input.priceRange,
    tags: input.tags.filter((t) => t.trim().length > 0).slice(0, 6).map((t) => clip(t, 40)),
    confidence: input.confidence,
    confidenceReason: clip(input.confidenceReason, 400),
    evidence: input.evidence
      .filter((ev) => ev.quote.trim().length > 0)
      .slice(0, 6)
      .map((ev) => ({ quote: clip(ev.quote, 500), source: clip(ev.source || "review", 120) })),
    citations,
    runnersUp: input.runnersUp
      .filter((ru) => ru.dishName.trim().length > 0)
      .slice(0, 3)
      .map((ru) => ({ dishName: clip(ru.dishName, 200), note: clip(ru.note, 300) })),
    photoNames: [],
    generatedAt: new Date().toISOString(),
  };
}
