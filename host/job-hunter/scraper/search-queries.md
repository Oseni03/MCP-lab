# Search Queries (Remotive-only)

<!-- SETUP: Customize these queries based on your skills and target roles -->

## Primary source

Remotive-only thin search via MCP (`search-jobs`) or debug CLI:

`node host/job-hunter/scraper/cli.ts search --location "<place>" --query "<keywords>"` (source defaults to `all` = `remotive`; `--source remotive` is the only supported narrow-down).

**Language scope:** write every query category in every language in the CLAUDE.md Languages table. Translate keywords, not word-for-word.

## Query Categories

Organize by function, not job title. One keyword query per call; the server pages via cursor.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

```
"[YOUR_PRIMARY_JOB_TITLE_1]" [YOUR_KEY_SKILL]
"[YOUR_PRIMARY_JOB_TITLE_2]" [YOUR_KEY_SKILL]
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

```
[YOUR_DOMAIN_KEYWORD_1]
[YOUR_DOMAIN_KEYWORD_2]
```

## Location Filter

Client-side filter on Remotive `candidate_required_location`. Acceptable: [YOUR_CITY] + surroundings; remote roles match `remote:true` regardless.

## Date Filter

Newest-first; no server-side recency gate in the thin contract. Prefer fresh `postedAt`; flag null dates as unknown.
