# Hematology Digest

Astro frontend with a small TypeScript backend for hematology research, journal, and specialty-news aggregation.

## Architecture

- `src/pages/index.astro`: static UI shell
- `src/lib/digest.ts`: shared aggregation and normalization logic
- `netlify/functions/digest.mts`: backend endpoint returning digest JSON
- `netlify.toml`: Netlify build config and `/api/digest` redirect

The frontend fetches data from `/api/digest`. The backend fetches the upstream sources on request and sends cache headers so Netlify can cache responses.

When running locally, the UI also shows backend source diagnostics if PubMed queries or feeds fail or return empty results.

## Local development

Install dependencies:

```bash
npm install
```

Run the full app locally:

```bash
npm run dev
```

This uses `netlify dev`, so both the Astro frontend and the Netlify function backend are available locally.

If you only want the Astro frontend shell without the backend, run:

```bash
npm run dev:astro
```

Production build:

```bash
npm run build
```

## Netlify deployment

1. Push the repo to GitHub.
2. Import it into Netlify.
3. Netlify should use:
   - build command: `npm run build`
   - publish directory: `dist`
   - Node version: `20`
4. Deploy.

No daily rebuild hook is needed in this architecture because the frontend reads from the backend endpoint instead of relying on static build-time data generation.

## Customize

- change PubMed queries in `src/lib/digest.ts`
- change RSS/news feeds in `src/lib/digest.ts`
- change UI in `src/pages/index.astro` and `src/styles/global.css`

Current note: the `News & Updates` section is currently backed by ASH newsroom press releases parsed from HTML, not a broader multi-source RSS news feed.

## TODO

- [ ] Add historical persistence for digests and entry snapshots so the app can support trending topics/therapies, real "new since" views, weekly comparisons, and source reliability tracking over time.
- [ ] Improve evidence extraction beyond title/abstract heuristics, especially for trial phase, sample size, approval/guideline detection, and study design normalization.
- [ ] Add personalized monitoring features such as saved topic/therapy/content presets, email or RSS alerts, and watchlists built from bookmarks.
- [ ] Harden search and taxonomy with better canonical mappings for drug names, brand/generic aliases, disease subtypes, modality classes, and conference acronyms.
- [ ] Run a frontend simplification pass to reduce UI density, especially in the overview, control bar, entry metadata, and mobile layouts.
