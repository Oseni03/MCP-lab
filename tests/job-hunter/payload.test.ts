import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decodeCursor, encodeCursor } from "@/lib/cursor.ts";

// Issue 14: cursor codec stays opaque and stateless.
describe("cursor codec (issue 14)", () => {
	it("round-trips an offset", () => {
		assert.equal(decodeCursor(encodeCursor(40)), 40);
		assert.equal(decodeCursor(encodeCursor(0)), 0);
	});

	it("returns null for absent or unparseable cursors", () => {
		assert.equal(decodeCursor(undefined), null);
		assert.equal(decodeCursor("not-a-cursor"), null);
		assert.equal(decodeCursor("!!!"), null);
	});

	it("stays opaque (no plain offset in the token)", () => {
		assert.ok(!encodeCursor(40).includes("40"), "offset must not leak as plain text");
	});
});

// Issue 14: paged search candidates within caller-held state.
describe("planSearch paging (issue 14)", () => {
	const PROFILE = {
		name: "Test Candidate",
		location: "Berlin, Germany",
		workCountry: "Germany",
		permitClasses: [],
		languages: [{ language: "English", level: "C1" }],
		preferences: { targetRoles: ["ML Engineer"] },
		skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }],
		domains: [{ name: "fraud detection", category: "strong" as const }],
		energizingTasks: [],
		drainingTasks: [],
	};

	function posting(index: number) {
		return {
			title: `Role ${index} ML Engineer`,
			company: "Acme",
			url: `https://example.com/jobs/${index}`,
			description: "Python and SQL for fraud detection with a long detailed team and stack description.",
			postedDate: "2026-09-20",
		};
	}

	it("pages the sorted candidates with an opaque next cursor", async () => {
		const { planSearch } = await import("@/lib/job-hunter/search.ts");
		const stub = async () => [posting(1), posting(2), posting(3)];
		const first = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: stub,
			filters: { limit: 2 },
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(first.candidates.length, 2);
		assert.ok(first.nextCursor, "more results remain");
		const second = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: stub,
			filters: { limit: 2 },
			cursor: first.nextCursor,
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(second.candidates.length, 1);
		assert.equal(second.nextCursor, null);
		const keys = [...first.candidates, ...second.candidates].map((candidate) => candidate.key);
		assert.equal(new Set(keys).size, 3, "pages cover every candidate exactly once");
	});

	it("treats an unparseable cursor as offset zero with a note", async () => {
		const { planSearch } = await import("@/lib/job-hunter/search.ts");
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [posting(1)],
			cursor: "garbage",
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates.length, 1);
		assert.ok(plan.notes.some((note) => note.includes("cursor")));
	});
});

// Issue 14: rank URLs-not-blobs, caller pre-ordering, and deferred resumption.
describe("planRank caller payload (issue 14)", () => {
	const PROFILE = {
		name: "Test Candidate",
		location: "Test City, Test Country",
		workCountry: "Test Country",
		permitClasses: [],
		languages: [{ language: "English", level: "C1" }],
		preferences: { targetRoles: ["ML Engineer"] },
		skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }],
		domains: [{ name: "fraud detection", category: "strong" as const }],
		energizingTasks: [],
		drainingTasks: [],
	};

	function item(key: string, overrides: Record<string, unknown> = {}) {
		return {
			key,
			title: "ML Engineer",
			company: "Acme",
			url: `https://example.com/${key}`,
			portal: "linkedin",
			postedDate: "2026-09-20",
			deadline: null,
			postingText: "ML Engineer at Acme.\nRequirements: Python, SQL.\nDomain: fraud detection.\nRemote.",
			...overrides,
		};
	}

	it("pre-orders caller-scored items before the limit slice", async () => {
		const { planRank } = await import("@/lib/job-hunter/rank.ts");
		const plan = await planRank({
			profile: PROFILE,
			items: [
				item("acme_low", { callerQuickFit: 10 }),
				item("acme_high", { callerQuickFit: 95 }),
				item("acme_mid", { callerQuickFit: 50 }),
			],
			limit: 2,
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.deepEqual(
			plan.ranked.map((entry) => entry.key),
			["acme_high", "acme_mid"],
			"caller evidence orders the slice; no rule weakened",
		);
		assert.equal(plan.deferredCount, 1);
	});

	it("resumes the deferred set via cursor without rescoring from scratch", async () => {
		const { planRank } = await import("@/lib/job-hunter/rank.ts");
		const items = [item("acme_1"), item("acme_2"), item("acme_3")];
		const first = await planRank({
			profile: PROFILE,
			items,
			limit: 2,
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(first.ranked.length, 2);
		assert.ok(first.nextCursor, "deferred remainder has a cursor");
		const second = await planRank({
			profile: PROFILE,
			items,
			limit: 2,
			cursor: first.nextCursor,
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.deepEqual(second.ranked.map((entry) => entry.key), [first.ranked.length === 2 ? "acme_3" : "none"]);
		assert.equal(second.nextCursor, null);
	});

	it("scores URL-only items by fetching server-side (URLs-not-blobs)", async () => {
		const { planRank } = await import("@/lib/job-hunter/rank.ts");
		const plan = await planRank({
			profile: PROFILE,
			items: [{ key: "acme_url", title: "ML Engineer", company: "Acme", url: "https://example.com/posting" }],
			fetchImpl: async () => ({
				status: 200,
				body: "<html><body><p>ML Engineer at Acme. Requirements: Python, SQL. Domain: fraud detection. Remote.</p></body></html>",
			}),
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.ranked.length, 1);
		assert.ok(plan.ranked[0].score > 0);
	});
});


