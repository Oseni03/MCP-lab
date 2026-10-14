# Job-hunter Remotive-only migration (locked spec)

The job-hunter MCP is now thin Remotive-only: `search-jobs` (thin list + cursor) → `analyze-job` (Groq-only detail+fit) → `tailor-resume` / `generate-cover-letter` → `setup-profile`. Five tools total.

## What was removed

- Adapters: indeed, linkedin, remoteok, wwr, hn, jobberman, myjobmag (+ `ts-jobspy` dep). Only `remotive` remains.
- Tools: career-strategy, draft-application-answers, due-followups, prepare-interview, rank-jobs, research-company, research-job, track-application.
- Workflows: job-key, rank-state, robots-check, salary-lookup, verify-pdf.
- Commands: `/rank`, `/interview` (deleted); `/scrape` + `/apply` rewritten to the 2-step flow.
- Tests pinning multi-adapter behavior rewritten (search, analyze) or deleted.

## State files (orphaned, not migrated)

`seen_jobs.json` (multi-portal keys) and `job_search_tracker.csv` are orphaned by this cut. They are left on disk untouched; no code reads them anymore. To re-adopt: treat tracker rows as read-only history and start fresh Remotive `jobUrl`-keyed tracking.

## Orphaned libs (pending follow-up)

`lib/job-hunter/{strategy,rank,job-research,fields,prep,record,followups,research-company}.ts` and versioned resources/prompts for deleted flows remain on disk but are unregistered. They typecheck and are unused; a follow-up deletes them once resources.ts is trimmed.
