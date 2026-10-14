import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { clearHttpCache } from "@/host/job-hunter/scraper/http.ts";
import {
	SEARCH_LIMIT_MAX,
	capLimit,
	planSearch,
	resolveSearchFilters,
} from "@/lib/job-hunter/search.ts";
import { encodeCursor } from "@/lib/cursor.ts";

function apiJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: Math.floor(Math.random() * 1_000_000),
		title: "ML Engineer",
		company_name: "Acme",
		candidate_required_location: "Worldwide",
		url: "https://example.com/jobs/1",
		description: "<p>Python and SQL for fraud detection.</p>",
		publication_date: "2026-09-20T12:00:00",
		...overrides,
	};
}

/** Stub the Remotive API behind the adapter; the memory cache is per-URL so it is cleared first. */
function stubRemotive(jobs: Record<string, unknown>[]): void {
	clearHttpCache();
	process.env.SCRAPER_CACHE_DISABLE = "1";
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ jobs }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		})) as typeof fetch;
}

describe("capLimit", () => {
	it("caps the limit at 20 and defaults to 10", () => {
		assert.equal(capLimit(50), SEARCH_LIMIT_MAX);
		assert.equal(capLimit(undefined), 10);
		assert.equal(capLimit(5), 5);
	});
});

describe("resolveSearchFilters", () => {
	it("keeps explicit filters when given", () => {
		const filters = resolveSearchFilters({ keywords: "Python", location: "Berlin, Germany" });
		assert.equal(filters.keywords, "Python");
		assert.equal(filters.location, "Berlin, Germany");
	});

	it("defaults to empty strings without a profile fallback", () => {
		const filters = resolveSearchFilters({ keywords: "Python" });
		assert.equal(filters.location, "");
	});
});

describe("planSearch (thin Remotive-only)", () => {
	let realFetch: typeof fetch | undefined;
	let savedCacheDisable: string | undefined;

	beforeEach(() => {
		realFetch = globalThis.fetch;
		savedCacheDisable = process.env.SCRAPER_CACHE_DISABLE;
	});

	afterEach(() => {
		globalThis.fetch = realFetch as typeof fetch;
		if (savedCacheDisable === undefined) delete process.env.SCRAPER_CACHE_DISABLE;
		else process.env.SCRAPER_CACHE_DISABLE = savedCacheDisable;
		clearHttpCache();
	});

	it("errors honestly on fetch failure instead of fabricating postings", async () => {
		clearHttpCache();
		process.env.SCRAPER_CACHE_DISABLE = "1";
		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as typeof fetch;
		const plan = await planSearch({});
		assert.deepEqual(plan.jobs, []);
		assert.ok(plan.errors.length > 0, "expected an explicit fetch error");
	});

	it("returns thin jobs without snippets or scores", async () => {
		stubRemotive([apiJob()]);
		const plan = await planSearch({});
		assert.equal(plan.jobs.length, 1);
		const job = plan.jobs[0];
		assert.equal(job.title, "ML Engineer");
		assert.equal(job.company, "Acme");
		assert.equal(job.url, "https://example.com/jobs/1");
		assert.equal(job.remote, true);
		assert.ok(!("snippet" in job), "no snippet in thin contract");
		assert.ok(!("quickFit" in job), "no scoring in thin contract");
	});

	it("dedupes by URL and sorts newest-first", async () => {
		stubRemotive([
			apiJob({ url: "https://example.com/jobs/1", publication_date: "2026-09-20T12:00:00" }),
			apiJob({ url: "https://example.com/jobs/1", publication_date: "2026-09-20T12:00:00" }),
			apiJob({ url: "https://example.com/jobs/2", publication_date: "2026-09-25T12:00:00" }),
		]);
		const plan = await planSearch({});
		assert.equal(plan.jobs.length, 2);
		assert.equal(plan.jobs[0].url, "https://example.com/jobs/2");
	});

	it("pages via the opaque cursor with limit as page size", async () => {
		stubRemotive(
			[1, 2, 3].map((n) =>
				apiJob({ id: n, title: `Role ${n}`, url: `https://example.com/jobs/${n}` }),
			),
		);
		const first = await planSearch({ filters: { limit: 2 } });
		assert.equal(first.jobs.length, 2);
		assert.ok(first.nextCursor, "expected a resume token");
		const second = await planSearch({
			filters: { limit: 2 },
			cursor: first.nextCursor as string,
		});
		assert.equal(second.jobs.length, 1);
		assert.equal(second.nextCursor, null);
	});

	it("restarts at zero with a note on an unparseable cursor", async () => {
		stubRemotive([apiJob()]);
		const plan = await planSearch({ cursor: "not-a-cursor" });
		assert.equal(plan.jobs.length, 1);
		assert.ok(plan.notes.some((note) => note.includes("cursor")));
	});

	it("drops unresolvable URLs with an honest error", async () => {
		stubRemotive([apiJob({ url: "not a url" })]);
		const plan = await planSearch({});
		assert.deepEqual(plan.jobs, []);
		assert.ok(plan.errors.length > 0);
	});

	it("strips URL fragments so ids stay stable", async () => {
		stubRemotive([apiJob({ url: "https://example.com/jobs/1#apply" })]);
		const plan = await planSearch({});
		assert.equal(plan.jobs[0].url, "https://example.com/jobs/1");
	});

	it("encodes cursor offsets compatibly with lib/cursor", async () => {
		stubRemotive(
			[1, 2, 3].map((n) => apiJob({ id: n, url: `https://example.com/jobs/${n}` })),
		);
		const plan = await planSearch({ filters: { limit: 1 }, cursor: encodeCursor(2) });
		assert.equal(plan.jobs.length, 1);
	});
});
