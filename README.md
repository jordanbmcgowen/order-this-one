# Order This One

Find the one must-order dish at any restaurant near you. Uses Google Places reviews and AI to surface the signature item worth going for.

## How It Works

1. Detects your location (or enter an address/zip manually)
2. Shows nearby restaurants with ratings and photos
3. Tap a restaurant to get a researched recommendation
4. AI analyzes Google reviews to find the standout dish

## Tech Stack

- **Frontend:** React + Tailwind CSS + shadcn/ui
- **Backend:** Cloudflare Pages Functions (serverless)
- **AI:** Claude (Anthropic) for dish analysis
- **APIs:** Google Maps Places, Photos, Geocoding
- **Cache:** Cloudflare KV (7-day TTL on recommendations)

## Deploy to Cloudflare Pages

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- Google Maps API key with Places, Photos, and Geocoding enabled
- Anthropic API key

### Steps

1. **Create a KV namespace:**

   ```bash
   wrangler kv namespace create RECOMMENDATIONS
   ```

   Copy the `id` from the output and paste it into `wrangler.toml`:

   ```toml
   [[kv_namespaces]]
   binding = "RECOMMENDATIONS"
   id = "your-kv-namespace-id"
   ```

2. **Set environment variables** in the Cloudflare dashboard (Pages > Settings > Environment variables):

   - `GOOGLE_MAPS_API_KEY`
   - `ANTHROPIC_API_KEY`

3. **Deploy:**

   ```bash
   npm install
   npm run deploy
   ```

   Or connect your GitHub repo in the Cloudflare Pages dashboard for automatic deploys on push.

### Local Development

```bash
cp .env.example .env
# Fill in your API keys in .env

npm install
npx wrangler pages dev dist -- npm run dev
```

Note: For local dev with Functions, you need `wrangler` to proxy API routes. Set your KV namespace preview ID in `wrangler.toml` or use `--kv` flag.

## Project Structure

```
├── client/           # React frontend (Vite)
│   └── src/
│       ├── pages/    # App pages
│       ├── components/  # shadcn/ui components
│       └── lib/      # Query client utilities
├── functions/        # Cloudflare Pages Functions
│   └── api/
│       ├── geocode.ts           # Address geocoding
│       └── restaurants/
│           ├── nearby.ts        # Nearby restaurant search
│           ├── photo.ts         # Photo proxy (protects API key)
│           └── recommend.ts     # AI dish recommendation
├── shared/           # Shared TypeScript types
├── wrangler.toml     # Cloudflare config
└── vite.config.ts    # Vite build config
```
