import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ScrapeMeta, ScrapeOptions } from "ts-jobspy";
import { adapters, searchAll, searchSource } from "@/host/job-hunter/scraper/index.ts";
import { buildScrapeOptions, createIndeedAdapter, createSiteAdapter, describeSiteMeta, linkedin, mapTsJobToScraperJob, resolveSiteCountry, summarizeScrapeMeta } from "@/host/job-hunter/scraper/adapters/tsjobspy.ts";
import { createScraperFetcher, planSearch } from "@/lib/job-hunter/search.ts";
import { SearchJobsInput } from "@/lib/job-hunter/schemas/search-jobs.ts";

// Seam 1: pure mapper ts-jobspy Job -> scraper Job (no network).
// Expected values are hand-worked literals from the ts-jobspy v3 schema,
// not recomputed by the implementation.
describe("ts-jobspy mapper (Indeed tracer bullet)", () => {
	it("maps a full Indeed posting, preferring the direct URL", () => {
		const job = mapTsJobToScraperJob({
			id: "17cf2abc",
			site: "indeed",
			jobUrl: "https://www.indeed.com/viewjob?jk=17cf2abc",
			jobUrlDirect: "https://www.adobe.com/careers/123",
			title: "Software Development Engineer",
			company: "Adobe",
			location: "San Jose, CA, US",
			datePosted: "2026-01-02",
			jobTypes: ["fulltime"],
			salarySource: "direct_data",
			interval: "yearly",
			minAmount: 139000,
			maxAmount: 257550,
			currency: "USD",
			isRemote: false,
			jobLevel: null,
			jobFunction: null,
			listingType: null,
			emails: [],
			description: "Build distributed systems in plain text.",
			companyIndustry: null,
			companyUrl: null,
			companyLogo: null,
			bannerPhotoUrl: null,
			companyUrlDirect: null,
			companyAddresses: null,
			companyNumEmployees: null,
			companyRevenue: null,
			companyDescription: null,
			skills: [],
			experienceRange: null,
			companyRating: null,
			companyReviewsCount: null,
			vacancyCount: null,
			workFromHomeType: null,
		});
		assert.equal(job.source, "indeed");
		assert.equal(job.title, "Software Development Engineer");
		assert.equal(job.company, "Adobe");
		assert.equal(job.url, "https://www.adobe.com/careers/123");
		assert.equal(job.location, "San Jose, CA, US");
		assert.equal(job.description, "Build distributed systems in plain text.");
		assert.ok(job.id.startsWith("indeed:"));
		assert.deepEqual(job.postedAt?.toISOString().slice(0, 10), "2026-01-02");
	});

	it("falls back honestly on null company, URL, and date", () => {
		const job = mapTsJobToScraperJob({
			id: null,
			site: "indeed",
			jobUrl: "https://www.indeed.com/viewjob?jk=deadbeef",
			jobUrlDirect: null,
			title: "ML Engineer",
			company: null,
			location: null,
			datePosted: null,
			jobTypes: [],
			salarySource: null,
			interval: null,
			minAmount: null,
			maxAmount: null,
			currency: null,
			isRemote: null,
			jobLevel: null,
			jobFunction: null,
			listingType: null,
			emails: [],
			description: null,
			companyIndustry: null,
			companyUrl: null,
			companyLogo: null,
			bannerPhotoUrl: null,
			companyUrlDirect: null,
			companyAddresses: null,
			companyNumEmployees: null,
			companyRevenue: null,
			companyDescription: null,
			skills: [],
			experienceRange: null,
			companyRating: null,
			companyReviewsCount: null,
			vacancyCount: null,
			workFromHomeType: null,
		});
		assert.equal(job.company, "Unknown company");
		assert.equal(job.url, "https://www.indeed.com/viewjob?jk=deadbeef");
		assert.equal(job.postedAt, undefined);
		assert.equal(job.description, undefined);
	});
});

// Seam 2: Adapter registry + Indeed search with an injected runner (no network).
describe("indeed adapter (injected runner)", () => {
	function tsJob(overrides = {}) {
		return {
			id: "abc123",
			site: "indeed" as const,
			jobUrl: "https://www.indeed.com/viewjob?jk=abc123",
			jobUrlDirect: null,
			title: "ML Engineer",
			company: "Acme",
			location: "Berlin, Germany",
			datePosted: "2026-09-25",
			jobTypes: [],
			salarySource: null,
			interval: null,
			minAmount: null,
			maxAmount: null,
			currency: null,
			isRemote: null,
			jobLevel: null,
			jobFunction: null,
			listingType: null,
			emails: [],
			description: "Python ML Engineer with a long detailed description of stack and team.",
			companyIndustry: null,
			companyUrl: null,
			companyLogo: null,
			bannerPhotoUrl: null,
			companyUrlDirect: null,
			companyAddresses: null,
			companyNumEmployees: null,
			companyRevenue: null,
			companyDescription: null,
			skills: [],
			experienceRange: null,
			companyRating: null,
			companyReviewsCount: null,
			vacancyCount: null,
			workFromHomeType: null,
			...overrides,
		};
	}

	it("is registered under 'indeed' without disturbing other adapters", () => {
		const names = adapters.map((adapter) => adapter.name);
		assert.ok(names.includes("indeed"));
		assert.ok(names.includes("linkedin"));
		assert.ok(names.includes("remotive"));
	});

	it("maps plan filters to ts-jobspy options with the total cap", () => {
		assert.deepEqual(buildScrapeOptions({ keywords: "ML Engineer", location: "Berlin, Germany", limit: 10 }), {
			sites: ["indeed"],
			searchTerm: "ML Engineer",
			location: "Berlin, Germany",
			resultsWanted: 10,
			hoursOld: 336,
			country: "usa",
			descriptionFormat: "plain",
			dedupe: "none",
			strict: false,
		});
	});

	it("searches through the injected runner and maps jobs", async () => {
		const seen: ScrapeOptions[] = [];
		const adapter = createIndeedAdapter(async (options) => {
			seen.push(options);
			return { jobs: [tsJob()], meta: { sites: [], totalDurationMs: 0, jobsPerSecond: 0, failureRate: 0, duplicatesRemoved: 0 } };
		});
		const jobs = await adapter.search({ keywords: "ML Engineer", location: "Berlin, Germany", limit: 5 });
		assert.equal(seen.length, 1);
		assert.deepEqual(seen[0].sites, ["indeed"]);
		assert.equal(jobs.length, 1);
		assert.equal(jobs[0].source, "indeed");
		assert.equal(jobs[0].company, "Acme");
	});

	it("lets runner errors throw so the planner records them with zero inventions", async () => {
		const adapter = createIndeedAdapter(async () => {
			throw new Error("indeed blocked");
		});
		await assert.rejects(() => adapter.search({ keywords: "x" }), /indeed blocked/);
	});

	it("searchSource resolves 'indeed' (registry wiring)", async () => {
		// Proves wiring only; live search would hit the network, so assert
		// resolution indirectly via the adapters list instead of calling it.
		assert.ok(adapters.some((adapter) => adapter.name === "indeed"));
		assert.equal(typeof searchSource, "function");
	});
});

// Seam 3: planSearch scraper source carries the Indeed Site tag end-to-end.
describe("planSearch with the Indeed Site", () => {
	const PROFILE = {
		name: "Test Candidate",
		location: "Berlin, Germany",
		workCountry: "Germany",
		permitClasses: [],
		languages: [{ language: "English", level: "C1" }],
		preferences: { targetRoles: ["ML Engineer"] },
		skills: [{ name: "Python", category: "primary" as const }],
		energizingTasks: [],
		drainingTasks: [],
	};
	const NOW = new Date("2026-10-03T12:00:00Z");

	it("returns indeed-portal candidates through limit and paging", async () => {
		const first = await planSearch({
			profile: PROFILE,
			filters: { keywords: "ML Engineer", location: "Berlin, Germany", limit: 10 },
			now: NOW,
			scraperAdapters: ["indeed"],
			scraperFetch: async () => [{
				title: "ML Engineer",
				company: "Acme",
				url: "https://www.indeed.com/viewjob?jk=abc123",
				description: "Python ML Engineer with a long detailed description of stack and team.",
				postedDate: "2026-09-25",
				portal: "indeed",
			}],
		});
		assert.equal(first.candidates.length, 1);
		assert.equal(first.candidates[0].portal, "indeed");
		assert.equal(first.candidates[0].postedDate, "2026-09-25");
		assert.equal(first.candidates[0].dateUnknown, false);
		assert.equal(first.errors.length, 0);
	});
});

// Seam 1b: pure mapper LinkedIn cases — tsJob.site drives source/id.
describe("ts-jobspy mapper (LinkedIn cutover)", () => {
	it("maps a LinkedIn posting under the linkedin source", () => {
		const job = mapTsJobToScraperJob({
			id: "4326639307",
			site: "linkedin",
			jobUrl: "https://www.linkedin.com/jobs/view/4326639307/",
			jobUrlDirect: null,
			title: "Software Engineer, Infrastructure",
			company: "Google",
			location: "Mountain View, CA",
			datePosted: "2025-12-31",
			jobTypes: ["fulltime"],
			salarySource: "direct_data",
			interval: "yearly",
			minAmount: 141000,
			maxAmount: 202000,
			currency: "USD",
			isRemote: false,
			jobLevel: null,
			jobFunction: null,
			listingType: null,
			emails: [],
			description: "Infrastructure snippet in plain text.",
			companyIndustry: null,
			companyUrl: null,
			companyLogo: null,
			bannerPhotoUrl: null,
			companyUrlDirect: null,
			companyAddresses: null,
			companyNumEmployees: null,
			companyRevenue: null,
			companyDescription: null,
			skills: [],
			experienceRange: null,
			companyRating: null,
			companyReviewsCount: null,
			vacancyCount: null,
			workFromHomeType: null,
		});
		assert.equal(job.source, "linkedin");
		assert.equal(job.title, "Software Engineer, Infrastructure");
		assert.equal(job.company, "Google");
		assert.equal(job.url, "https://www.linkedin.com/jobs/view/4326639307/");
		assert.ok(job.id.startsWith("linkedin:"));
		assert.deepEqual(job.postedAt?.toISOString().slice(0, 10), "2025-12-31");
	});
});

// Seam 2b: site-parameterized options builder.
describe("site options builder (LinkedIn cutover)", () => {
	it("defaults to the Indeed Site so ticket-01 calls are unchanged", () => {
		const options = buildScrapeOptions({ keywords: "ML Engineer", location: "Berlin, Germany", limit: 10 });
		assert.deepEqual(options.sites, ["indeed"]);
		assert.equal(options.country, "usa");
	});

	it("builds LinkedIn options with rich descriptions off", () => {
		const options = buildScrapeOptions({ keywords: "ML Engineer", location: "Berlin, Germany", limit: 10 }, "linkedin");
		assert.deepEqual(options.sites, ["linkedin"]);
		assert.deepEqual(options.linkedin, { fetchDescription: false });
		assert.equal(options.resultsWanted, 10);
		assert.equal(options.hoursOld, 336);
		assert.equal(options.descriptionFormat, "plain");
		assert.equal(options.dedupe, "none");
		assert.equal(options.strict, false);
	});

	it("maps the onsite workplace filter to a non-remote search", () => {
		const options = buildScrapeOptions({ keywords: "x", remoteFilter: "onsite", limit: 5 }, "linkedin");
		assert.equal(options.isRemote, false);
	});
});

// Seam 3b: registry 'linkedin' is the Site adapter (injected runner, no network).
describe("linkedin adapter (injected runner)", () => {
	it("is the shared Site client, not the legacy guest scraper", () => {
		const registered = adapters.find((adapter) => adapter.name === "linkedin");
		assert.equal(registered, linkedin);
	});

	it("searches through the injected runner and maps jobs", async () => {
		const seen: ScrapeOptions[] = [];
		const adapter = createSiteAdapter("linkedin", async (options) => {
			seen.push(options);
			return {
				jobs: [{
					id: "4326639307",
					site: "linkedin",
					jobUrl: "https://www.linkedin.com/jobs/view/4326639307/",
					jobUrlDirect: null,
					title: "Software Engineer, Infrastructure",
					company: "Google",
					location: "Mountain View, CA",
					datePosted: "2025-12-31",
					jobTypes: [],
					salarySource: null,
					interval: null,
					minAmount: null,
					maxAmount: null,
					currency: null,
					isRemote: null,
					jobLevel: null,
					jobFunction: null,
					listingType: null,
					emails: [],
					description: "Infrastructure snippet in plain text.",
					companyIndustry: null,
					companyUrl: null,
					companyLogo: null,
					bannerPhotoUrl: null,
					companyUrlDirect: null,
					companyAddresses: null,
					companyNumEmployees: null,
					companyRevenue: null,
					companyDescription: null,
					skills: [],
					experienceRange: null,
					companyRating: null,
					companyReviewsCount: null,
					vacancyCount: null,
					workFromHomeType: null,
				}],
				meta: { sites: [], totalDurationMs: 0, jobsPerSecond: 0, failureRate: 0, duplicatesRemoved: 0 },
			};
		});
		const jobs = await adapter.search({ keywords: "Software Engineer", location: "Mountain View, CA", limit: 5 });
		assert.equal(seen.length, 1);
		assert.deepEqual(seen[0].sites, ["linkedin"]);
		assert.equal(jobs.length, 1);
		assert.equal(jobs[0].source, "linkedin");
		assert.equal(jobs[0].company, "Google");
	});
});

// Seam 1 (ticket 03): pure Site-meta mapping and country resolution.
describe("site meta honesty (ticket 03)", () => {
	it("notes full and genuinely empty runs", () => {
		assert.deepEqual(describeSiteMeta({ site: "indeed", status: "ok", jobs: 10, requested: 10, durationMs: 500, jobsPerSecond: 20 }), {
			note: "Site indeed: ok — 10 job(s) in 500ms.",
		});
		assert.deepEqual(describeSiteMeta({ site: "indeed", status: "empty", jobs: 0, requested: 10, durationMs: 400, jobsPerSecond: 0 }), {
			note: "Site indeed: empty — no matches (never a block).",
		});
	});

	it("errors interrupted and failed runs with the board's reason", () => {
		assert.deepEqual(
			describeSiteMeta({ site: "linkedin", status: "partial", jobs: 9, requested: 15, durationMs: 3000, jobsPerSecond: 3, error: { name: "RateLimitException", message: "429 rate limited" } }),
			{ error: "Site linkedin: partial — 9 job(s) kept, then interrupted: 429 rate limited" },
		);
		assert.deepEqual(
			describeSiteMeta({ site: "linkedin", status: "error", jobs: 0, requested: 15, durationMs: 200, jobsPerSecond: 0, error: { name: "LinkedInException", message: "guest wall" } }),
			{ error: "Site linkedin: error — guest wall" },
		);
	});

	it("notes dropped filters instead of silently ignoring them", () => {
		assert.deepEqual(
			describeSiteMeta({ site: "indeed", status: "ok", jobs: 4, requested: 10, durationMs: 500, jobsPerSecond: 8, unsupportedOptions: ["easyApply"] }),
			{
				note: "Site indeed: ok — 4 job(s) in 500ms. Site indeed ignores unsupported option(s): easyApply.",
			},
		);
	});

	it("splits a mixed scrape into notes and errors", () => {
		const summary = summarizeScrapeMeta({
			sites: [
				{ site: "indeed", status: "ok", jobs: 10, requested: 10, durationMs: 500, jobsPerSecond: 20 },
				{ site: "linkedin", status: "error", jobs: 0, requested: 10, durationMs: 200, jobsPerSecond: 0, error: { name: "RateLimitException", message: "429 rate limited" } },
			],
			totalDurationMs: 700,
			jobsPerSecond: 14,
			failureRate: 0.5,
			duplicatesRemoved: 0,
		});
		assert.deepEqual(summary.notes, ["Site indeed: ok — 10 job(s) in 500ms."]);
		assert.deepEqual(summary.errors, ["Site linkedin: error — 429 rate limited"]);
	});

	it("derives the Indeed country from the profile with a safe fallback", () => {
		assert.equal(resolveSiteCountry("Germany"), "germany");
		assert.equal(resolveSiteCountry("  United Kingdom  "), "united kingdom");
		assert.equal(resolveSiteCountry(""), "usa");
	});
});

// Seam 2 (ticket 03): country and meta-collector threading through the fetcher.
describe("fetcher threading (ticket 03)", () => {
	it("threads an explicit country into options", () => {
		const options = buildScrapeOptions({ keywords: "x", location: "Berlin, Germany", limit: 5 }, "indeed", "germany");
		assert.equal(options.country, "germany");
	});

	it("forwards Site meta from the adapter query to the planner callback", async () => {
		const seen: unknown[] = [];
		const metas: unknown[] = [];
		const cannedMeta: ScrapeMeta = {
			sites: [{ site: "indeed", status: "ok", jobs: 1, requested: 5, durationMs: 100, jobsPerSecond: 10 }],
			totalDurationMs: 100,
			jobsPerSecond: 10,
			failureRate: 0,
			duplicatesRemoved: 0,
		};
		const fetch = createScraperFetcher(
			{ location: "Berlin, Germany", limit: 5, adapters: ["indeed"], country: "germany" },
			async (query) => {
				seen.push(query);
				query.metaSink?.(cannedMeta);
				return [{
					id: "indeed:1",
					source: "indeed",
					title: "ML Engineer",
					company: "Acme",
					url: "https://www.indeed.com/viewjob?jk=1",
					description: "Python role with detail.",
					postedAt: new Date("2026-09-25T10:00:00Z"),
				}];
			},
			(meta) => {
				metas.push(meta);
			},
		);
		const postings = await fetch("ML Engineer");
		assert.equal(postings.length, 1);
		assert.equal(postings[0].portal, "indeed");
		assert.equal((seen[0] as { country?: string }).country, "germany");
		assert.deepEqual(metas, [cannedMeta]);
	});
});

// Seam 3 (ticket 03): failure isolation with zero inventions.
describe("failure isolation (ticket 03)", () => {
	it("keeps the healthy adapter's jobs when another adapter fails", async () => {
		const jobs = await searchAll({ keywords: "ML Engineer", limit: 5 }, {
			adapters: [
				{ name: "dead", search: async () => { throw new Error("dead board"); } },
				{
					name: "alive",
					search: async () => [{
						id: "alive:1",
						source: "alive",
						title: "ML Engineer",
						company: "Acme",
						url: "https://example.com/jobs/1",
					}],
				},
			],
		});
		assert.equal(jobs.length, 1);
		assert.equal(jobs[0].company, "Acme");
	});

	it("records a throwing fetch as errors with zero invented postings", async () => {
		const plan = await planSearch({
			profile: {
				name: "Test Candidate",
				location: "Berlin, Germany",
				workCountry: "Germany",
				permitClasses: [],
				languages: [{ language: "English", level: "C1" }],
				preferences: { targetRoles: ["ML Engineer"] },
		skills: [{ name: "Python", category: "primary" as const }],
				energizingTasks: [],
				drainingTasks: [],
			},
			filters: { keywords: "ML Engineer", location: "Berlin, Germany" },
			now: new Date("2026-10-03T12:00:00Z"),
			scraperAdapters: ["indeed"],
			scraperFetch: async () => { throw new Error("indeed blocked"); },
		});
		assert.deepEqual(plan.candidates, []);
		assert.ok(plan.errors.some((error) => error.includes("indeed blocked")));
	});
});

// Ticket 04: board-path contract removal — rejected, never silently ignored.
describe("board contract removal (ticket 04)", () => {
	it("rejects board refs as unknown input", () => {
		assert.throws(
			() => SearchJobsInput.parse({ boards: [{ provider: "lever", slug: "acme", company: "Acme" }] }),
			/boards/,
		);
	});

	it("registers no board adapters", () => {
		const names = adapters.map((adapter) => adapter.name);
		assert.ok(!names.includes("greenhouse"));
		assert.ok(!names.includes("lever"));
		assert.ok(!names.includes("ashby"));
		assert.ok(names.includes("indeed"));
		assert.ok(names.includes("linkedin"));
		assert.throws(() => searchSource("greenhouse", { keywords: "x" }), /Unknown scraper adapter/);
	});

	it("carries no Source field and tags candidates by adapter", async () => {
		const plan = await planSearch({
			profile: {
				name: "Test Candidate",
				location: "Berlin, Germany",
				workCountry: "Germany",
				permitClasses: [],
				languages: [{ language: "English", level: "C1" }],
				preferences: { targetRoles: ["ML Engineer"] },
		skills: [{ name: "Python", category: "primary" as const }],
				energizingTasks: [],
				drainingTasks: [],
			},
			filters: { keywords: "ML Engineer", location: "Berlin, Germany" },
			now: new Date("2026-10-03T12:00:00Z"),
			scraperAdapters: ["indeed"],
			scraperFetch: async () => [{
				title: "ML Engineer",
				company: "Acme",
				url: "https://www.indeed.com/viewjob?jk=abc123",
				description: "Python ML Engineer with a long detailed description of stack and team.",
				postedDate: "2026-09-25",
				portal: "indeed",
			}],
		});
		assert.ok(!("sources" in plan), "plan carries no sources field");
		for (const candidate of plan.candidates) {
			assert.ok(!("source" in candidate), "candidate carries no source field");
			assert.equal(candidate.portal, "indeed");
		}
	});
});

// Ticket 05: Site searches never touch the legacy disk cache.
describe("site cache isolation (ticket 05)", () => {
	it("writes nothing to the disk cache", async () => {
		const dir = mkdtempSync(join(tmpdir(), "site-cache-probe-"));
		const savedDir = process.env.SCRAPER_CACHE_DIR;
		const savedDisable = process.env.SCRAPER_CACHE_DISABLE;
		process.env.SCRAPER_CACHE_DIR = dir;
		delete process.env.SCRAPER_CACHE_DISABLE;
		try {
			const adapter = createSiteAdapter("indeed", async () => ({
				jobs: [],
				meta: { sites: [], totalDurationMs: 0, jobsPerSecond: 0, failureRate: 0, duplicatesRemoved: 0 },
			}));
			await adapter.search({ keywords: "x", limit: 1 });
			assert.deepEqual(readdirSync(dir), []);
		} finally {
			if (savedDir === undefined) delete process.env.SCRAPER_CACHE_DIR;
			else process.env.SCRAPER_CACHE_DIR = savedDir;
			if (savedDisable !== undefined) process.env.SCRAPER_CACHE_DISABLE = savedDisable;
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
