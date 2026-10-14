---
name: scrape
description: >
  Finds new remote postings via the Remotive-only thin search (MCP search-jobs
  or debug CLI). Triggers on: job scrape, find jobs, search jobs, new jobs,
  job search, scrape jobs, /scrape
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node --version), Bash(node host/job-hunter/scraper/cli.ts *), WebFetch, WebSearch, Agent, AskUserQuestion
---

# Job Scraper (Remotive-only)

Searches Remotive via `search-jobs` (preferred) or the debug CLI, using queries from the profile. Presents thin matches; full fit comes from `analyze-job` (Groq).

Triggers: "Find new jobs", "Scrape for jobs", "Any new positions?", "/scrape". Args: focus area ("/scrape data science"), "broad" (all categories).

## Step 0: Load State

1. Read `search-queries.md` for strategy (Remotive keyword categories).

## Step 1: Search

Default: top 3 priority categories; "broad": all; focus: that category first.

1a. Prefer the `search-jobs` MCP tool: `{keywords, location, limit (page size, max 20), cursor}` → `{jobs, nextCursor}`. Page with `cursor` until covered. 1b. Debug CLI fallback: `node host/job-hunter/scraper/cli.ts search --location "<place>" --query "<keywords>" --limit 20 --format json` (`--source` only `remotive`/`all`). Log non-zero exits and continue. 1c. WebSearch with `search-queries.md` only for CLI/MCP gaps; tag source.

## Step 2: Fetch & Parse

Search hits carry title/company/location/date/URL (Remotive descriptions are full; no snippet). For promising ones, resolve full text via `search-jobs` hit description or `cli detail <url>`. Store only resolvable posting URLs. Skip URLs already presented this session or company+role in tracker.

## Step 3: Present Results

Table sorted newest-first (thin list has no scores): title, company, location, posted date, URL. Ask "Want me to evaluate any of these in detail? Just give me the number(s)." → picked numbers invoke `analyze-job` on that URL (Groq fit), then docs on approval.

Rules: never fabricate; Remotive-only; open positions only; no automated people lookups; flag distribution, never accuse.
