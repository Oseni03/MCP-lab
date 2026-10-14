---
name: linkedin-search
version: 3.0.0
description: >
  Use this skill whenever the user wants to search for jobs, find job listings,
  or look up a specific job posting on the Remotive remote board.
  Trigger phrases: find a job, job search, search for jobs, job openings,
  vacancies, hiring, positions open, remote jobs.
context: fork
enabled: true
allowed-tools: Bash(node host/job-hunter/scraper/cli.ts *)
---

# Remotive Search Skill (Remotive-only)

Search live remote listings from the single Remotive adapter via one thin CLI,
or via the `search-jobs` MCP tool (preferred). No authentication, no API key,
zero extra runtime dependencies beyond `npm install` — runs with plain `node`.
Location is always passed explicitly (client-side filter).

## Commands

### Search job listings

```bash
node host/job-hunter/scraper/cli.ts search --location "<place>" [flags]
```

Flags: `--location/-l` **required**; `--query/-q` keyword (recommended, maps to Remotive `?search=`); `--jobage` days; `--jobage-minutes` sub-day (conflicts with `--jobage`); `--remote` remote/hybrid/onsite (Remotive hits are remote); `--page`; `--limit/-n` page size (default 10, max 20); `--source/-s` only `remotive` or `all` (default `all` = remotive); `--format json|table|plain` (default json); `--enrich` re-fetches when the description is missing.

Matching is server-side (`?search=`) plus client-side location filtering — niche keywords can return few results. Output is thin (no snippets, no scores); run `analyze-job` on a URL for Groq fit.

Responses are cached on disk (`.scratch/scrape-cache/`, gitignored). Bypass with `SCRAPER_CACHE_DISABLE=1`, relocate with `SCRAPER_CACHE_DIR`.

### Fetch full job detail

```bash
node host/job-hunter/scraper/cli.ts detail <url> [--format json|plain]
```

Accepts a full Remotive job URL. Returns title, company, URL, and full description text.

### List sources

```bash
node host/job-hunter/scraper/cli.ts sources [--format json|table|plain]
```

Lists the single registered adapter (`remotive`); runs without configuration.

## Notes

- MCP flow: `search-jobs` (thin list + cursor) → `analyze-job` (Groq fit) → `tailor-resume` / `generate-cover-letter`.
- CLI retries 429/5xx with exponential backoff. Errors to stderr as `{ "error": "...", "code": "..." }`, exit 1.
