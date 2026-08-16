# Order This One

The single best item to order at any restaurant in America — researched, evidence-backed, and self-correcting.

Pick a restaurant (nearby list or name search) and the engine returns **one dish**, with the receipts: verbatim quotes, source links, a confidence grade, and the runners-up it beat.

## How the recommendation engine works

Accuracy comes from evidence, not vibes:

1. **Google Places research** — the engine pulls the restaurant's aggregated AI review summary (covering *all* reviews, not just five), editorial summary, and individual reviews via the Places API (New).
2. **Web research** — Claude (Opus 5) uses Anthropic's server-side web search tool to check Reddit threads, local food press (Eater, The Infatuation, local papers), and review-site discussion, cross-referencing the leading candidates and confirming it's looking at *this* restaurant at *this* address.
3. **Structured, validated output** — the answer comes back through a strict-schema tool call (no brittle JSON parsing), then is re-validated server-side with zod. The engine is forbidden from inventing dishes, paraphrased "quotes", or fake URLs; if evidence is thin it must say so.
4. **Honest confidence** — every pick is graded `high` (3+ independent sources converge), `medium`, or `low` (best-effort, flagged to the user), with a one-line reason.
5. **Confidence-weighted caching** — results are cached in Cloudflare KV: 30 days for high confidence, 14 for medium, 3 for low, so weak picks get re-researched sooner.
6. **Feedback loop** — diners vote "Nailed it" / "Wrong pick". Repeated wrong-pick reports discredit the cached answer and trigger a fresh research pass that is told about the rejected dish.

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/restaurants/nearby?lat&lng&radius` | GET | Nearby restaurants (Places API New, popularity-ranked) |
| `/api/restaurants/autocomplete?input&lat&lng` | GET | Restaurant name search |
| `/api/restaurants/details?placeId` | GET | One restaurant's card data |
| `/api/restaurants/recommend` | POST `{placeId}` | The dish recommendation (cached) |
| `/api/restaurants/feedback` | POST `{placeId, dishName, vote}` | Thumbs up/down on a pick |
| `/api/restaurants/photo?name` | GET | Places photo proxy (keeps the API key server-side) |
| `/api/geocode?address` | GET | Manual location entry |

## Tech Stack

- **Frontend:** React + Tailwind CSS + shadcn/ui (Vite)
- **Backend:** Cloudflare Pages Functions
- **AI:** Claude Opus 5 (`@anthropic-ai/sdk`) with server-side web search + strict tool output
- **Data:** Google Places API (New), Google Geocoding API
- **Storage:** Cloudflare KV (recommendations + feedback)

## Deploy to Cloudflare Pages

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) and [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Google Maps API key with **Places API (New)**, **Place Photos**, and **Geocoding API** enabled
- Anthropic API key

### Steps

1. **Create a KV namespace:**

   ```bash
   wrangler kv namespace create RECOMMENDATIONS
   ```

   Put the returned `id` in `wrangler.toml`:

   ```toml
   [[kv_namespaces]]
   binding = "RECOMMENDATIONS"
   id = "your-kv-namespace-id"
   ```

2. **Set environment variables** in the Cloudflare dashboard (Pages → Settings → Environment variables):

   - `GOOGLE_MAPS_API_KEY`
   - `ANTHROPIC_API_KEY`

3. **Deploy:**

   ```bash
   npm install
   npm run deploy
   ```

   Or connect the GitHub repo in the Cloudflare Pages dashboard for automatic deploys on push.

### Local Development

```bash
cp .env.example .env   # fill in your API keys

npm install
npm run build
npx wrangler pages dev dist
```

## Project Structure

```
├── client/src/           # React frontend
│   └── pages/home.tsx    # Browse, research, result + feedback UI
├── functions/api/        # Cloudflare Pages Functions
│   ├── geocode.ts
│   └── restaurants/
│       ├── nearby.ts         # Places (New) nearby search
│       ├── autocomplete.ts   # Places (New) autocomplete
│       ├── details.ts        # Places (New) details
│       ├── photo.ts          # Photo proxy
│       ├── recommend.ts      # Research engine (Claude Opus 5 + web search)
│       └── feedback.ts       # Community verification votes
├── shared/schema.ts      # Shared types + zod validation
└── wrangler.toml         # Cloudflare config (nodejs_compat enabled)
```

## Notes on cost & latency

- First lookup for a restaurant runs a full research pass (typically 30–90s); every later lookup is served from KV instantly until the TTL expires or feedback discredits the pick.
- The recommendation request caps web searches at 6 and output at 16K tokens, and the system prompt is cached with Anthropic prompt caching.
- A refusal-fallback (`claude-opus-4-8`) is configured so a safety-classifier false positive degrades gracefully instead of failing the request.
