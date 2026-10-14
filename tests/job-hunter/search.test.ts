import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	SEARCH_LIMIT_MAX,
	capLimit,
	planSearch,
	resolveSearchFilters,
} from "@/lib/job-hunter/search.ts";
import type { RawPosting } from "@/lib/job-hunter/search.ts";
import { encodeCursor } from "@/lib/cursor.ts";

function posting(overrides: Partial<RawPosting> = {}): RawPosting {
	return {
		title: "ML Engineer",
		company: "Acme",
		url: "https://example.com/jobs/1",
		description: "Python and SQL for fraud detection.",
		postedDate: "2026-09-20",
		...overrides,
	};
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
	it("errors honestly when no source can run instead of fabricating postings", async () => {
		const plan = await planSearch({});
		assert.deepEqual(plan.jobs, []);
		assert.ok(plan.errors.length > 0, "expected an explicit no-source error");
	});

	it("rejects non-remotive adapters in the thin contract", async () => {
		const plan = await planSearch({
			scraperAdapters: ["linkedin"],
			scraperFetch: async () => [posting()],
		});
		assert.deepEqual(plan.jobs, []);
		assert.ok(plan.errors.some((error) => error.includes("remotive")));
	});

	it("returns thin jobs without snippets or scores", async () => {
		const plan = await planSearch({
			scraperAdapters: ["remotive"],
			scraperFetch: async () => [posting()],
		});
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
		const plan = await planSearch({
			scraperAdapters: ["remotive"],
			scraperFetch: async () => [
				posting({ url: "https://example.com/jobs/1", postedDate: "2026-09-20" }),
				posting({ url: "https://example.com/jobs/1", postedDate: "2026-09-20" }),
				posting({ url: "https://example.com/jobs/2", postedDate: "2026-09-25" }),
			],
		});
		assert.equal(plan.jobs.length, 2);
		assert.equal(plan.jobs[0].url, "https://example.com/jobs/2");
	});

	it("pages via the opaque cursor with limit as page size", async () => {
		const raws = [1, 2, 3].map((n) =>
			posting({ title: `Role ${n}`, url: `https://example.com/jobs/${n}` }),
		);
		const first = await planSearch({
			filters: { limit: 2 },
			scraperAdapters: ["remotive"],
			scraperFetch: async () => raws,
		});
		assert.equal(first.jobs.length, 2);
		assert.ok(first.nextCursor, "expected a resume token");
		const second = await planSearch({
			filters: { limit: 2 },
			scraperAdapters: ["remotive"],
			scraperFetch: async () => raws,
			cursor: first.nextCursor as string,
		});
		assert.equal(second.jobs.length, 1);
		assert.equal(second.nextCursor, null);
	});

	it("restarts at zero with a note on an unparseable cursor", async () => {
		const plan = await planSearch({
			scraperAdapters: ["remotive"],
			scraperFetch: async () => [posting()],
			cursor: "not-a-cursor",
		});
		assert.equal(plan.jobs.length, 1);
		assert.ok(plan.notes.some((note) => note.includes("cursor")));
	});

	it("drops unresolvable URLs with an honest error", async () => {
		const plan = await planSearch({
			scraperAdapters: ["remotive"],
			scraperFetch: async () => [posting({ url: "not a url" })],
		});
		assert.deepEqual(plan.jobs, []);
		assert.ok(plan.errors.length > 0);
	});

	it("strips URL fragments so ids stay stable", async () => {
		const plan = await planSearch({
			scraperAdapters: ["remotive"],
			scraperFetch: async () => [posting({ url: "https://example.com/jobs/1#apply" })],
		});
		assert.equal(plan.jobs[0].url, "https://example.com/jobs/1");
	});

	it("accepts 'all' as a remotive alias", async () => {
		const plan = await planSearch({
			scraperAdapters: ["all"],
			scraperFetch: async () => [posting()],
		});
		assert.equal(plan.jobs.length, 1);
	});

	it("encodes cursor offsets compatibly with lib/cursor", async () => {
		const token = encodeCursor(2);
		const plan = await planSearch({
			filters: { limit: 1 },
			scraperAdapters: ["remotive"],
			scraperFetch: async () => [
				posting({ url: "https://example.com/jobs/1" }),
				posting({ url: "https://example.com/jobs/2" }),
				posting({ url: "https://example.com/jobs/3" }),
			],
			cursor: token,
		});
		assert.equal(plan.jobs.length, 1);
	});
});
