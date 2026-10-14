import {
	adapters as scraperRegistry,
	searchAll as searchScrapers,
} from "@/host/job-hunter/scraper/index.ts";
import type { Job as ScrapedJob, SearchQuery as ScraperQuery } from "@/host/job-hunter/scraper/index.ts";
import { decodeCursor, encodeCursor } from "@/lib/cursor.ts";

/**
 * Thin Remotive-only job discovery (locked spec Q8+Q11):
 * one keyword query in, newest-first thin list out. No profile import,
 * no scoring, no auto-queries, no snippets. The limit doubles as the page
 * size with an opaque offset cursor; the server holds no state.
 */

export const SEARCH_LIMIT_MAX = 20;
export const SEARCH_LIMIT_DEFAULT = 10;

export interface SearchFilters {
	keywords?: string;
	location?: string;
	limit?: number;
}

export interface ResolvedFilters {
	keywords: string;
	location: string;
	limit: number;
}

/** Caps the result limit at 20; defaults to 10, floors at 1. */
export function capLimit(limit: number | undefined): number {
	if (limit === undefined || limit === null || Number.isNaN(limit)) {
		return SEARCH_LIMIT_DEFAULT;
	}
	return Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.floor(limit)));
}

/** Explicit filters only; no profile fallback in the thin contract. */
export function resolveSearchFilters(
	filters: SearchFilters | undefined,
	_profile?: unknown,
): ResolvedFilters {
	return {
		keywords: filters?.keywords?.trim() ?? "",
		location: filters?.location?.trim() ?? "",
		limit: capLimit(filters?.limit),
	};
}

export interface ThinJob {
	id: string;
	title: string;
	company: string;
	url: string;
	location: string | null;
	postedAt: string | null;
	remote: boolean;
}

export interface SearchInput {
	filters?: SearchFilters;
	now?: Date;
	/**
	 * Scraper adapters to run. Thin contract accepts only "remotive" or
	 * "all" (alias for remotive). Undefined or empty means no fetch runs.
	 * Internal test seam: injected fetchers bypass the registry.
	 */
	scraperAdapters?: string[];
	/** Injected scraper fetcher; defaults to the live Remotive adapter. */
	scraperFetch?: PostingFetcher;
	/** Opaque resume token from a previous page; unparseable restarts at 0. */
	cursor?: string;
}

export interface SearchPlan {
	filters: ResolvedFilters;
	jobs: ThinJob[];
	/** Opaque resume token when jobs remain past this page; null when exhausted. */
	nextCursor: string | null;
	notes: string[];
	errors: string[];
}

export interface RawPosting {
	title: string;
	company: string;
	url: string;
	description?: string;
	postedDate?: string;
	portal?: string;
	location?: string;
	remote?: boolean;
}

/** Injected scraper fetch: one query in, raw postings out. Keeps unit tests off the network. */
export type PostingFetcher = (query: string) => Promise<RawPosting[]>;

function isHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function toThinJob(raw: RawPosting): ThinJob | null {
	const title = raw.title?.trim() || "Untitled role";
	const company = raw.company?.trim() || "Unknown company";
	const url = (raw.url ?? "").split("#")[0].trim();
	if (!isHttpUrl(url)) {
		return null;
	}
	let postedAt: string | null = null;
	if (raw.postedDate) {
		const parsed = new Date(raw.postedDate);
		postedAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
	}
	return {
		id: `remotive:${url}`,
		title,
		company,
		url,
		location: raw.location?.trim() ? raw.location.trim() : null,
		postedAt,
		remote: true,
	};
}

export async function planSearch(input: SearchInput): Promise<SearchPlan> {
	const filters = resolveSearchFilters(input.filters);
	const notes: string[] = [];
	const errors: string[] = [];

	let offset = 0;
	if (input.cursor !== undefined) {
		const decoded = decodeCursor(input.cursor);
		if (decoded === null) {
			notes.push("Unparseable page cursor ignored; restarted at offset zero (correctness first).");
		} else {
			offset = decoded;
		}
	}

	const adapters = input.scraperAdapters ?? [];
	const wantsRemotive = adapters.includes("all") || adapters.includes("remotive");
	if (adapters.length === 0 || !wantsRemotive) {
		if (adapters.length === 0) {
			errors.push("No search source available (no scraper adapters); no postings invented.");
		} else {
			errors.push(
				`Unknown scraper adapter '${adapters.join(",")}': thin contract supports only 'remotive' (or 'all').`,
			);
		}
		return { filters, jobs: [], nextCursor: null, notes, errors };
	}

	const query = filters.keywords;
	let raws: RawPosting[] = [];
	try {
		const fetch =
			input.scraperFetch ??
			createScraperFetcher({ location: filters.location, adapters: ["remotive"] });
		raws = await fetch(query);
		notes.push(`Remotive-only run for "${query || "(all)"}"; single query.`);
	} catch (error) {
		errors.push(`Scraper fetch failed for "${query}" (${String(error)}); no postings invented.`);
		return { filters, jobs: [], nextCursor: null, notes, errors };
	}

	const thins: ThinJob[] = [];
	for (const raw of raws) {
		const thin = toThinJob(raw);
		if (!thin) {
			errors.push(`Dropped an unresolvable posting URL for "${raw.title}" at "${raw.company}"; nothing invented.`);
			continue;
		}
		thins.push(thin);
	}

	// Dedupe by URL, newest-first (null dates last), stable by id.
	const seen = new Set<string>();
	const deduped = thins.filter((job) => {
		const key = job.url.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	deduped.sort(
		(a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "") || a.id.localeCompare(b.id),
	);

	const page = deduped.slice(offset, offset + filters.limit);
	const nextCursor = offset + filters.limit < deduped.length ? encodeCursor(offset + filters.limit) : null;
	return { filters, jobs: page, nextCursor, notes, errors };
}

/**
 * Local scraper runner over the Remotive-only registry (no key, host
 * network). "all" is an alias for remotive in the thin contract; any other
 * name throws, recorded per query. Kept injectable so unit tests never
 * touch the network.
 */
export type ScraperRunner = (query: ScraperQuery) => Promise<ScrapedJob[]>;

function defaultScraperRunner(adapterNames: string[]): ScraperRunner {
	return (query) => {
		if (adapterNames.includes("all") || adapterNames.includes("remotive")) {
			const remotive = scraperRegistry.find((candidate) => candidate.name === "remotive");
			if (!remotive) throw new Error("Remotive adapter not registered");
			return searchScrapers(query, { adapters: [remotive] });
		}
		const known = scraperRegistry.map((candidate) => candidate.name).join(", ");
		throw new Error(`Unknown scraper adapter '${adapterNames.join(",")}'. Registered: ${known}`);
	};
}

export interface ScraperFetchOptions {
	location: string;
	limit?: number;
	adapters: string[];
}

/**
 * PostingFetcher over the Remotive adapter: each query runs with the plan's
 * location filter. Location matching stays client-side in the adapter
 * helpers; ISO dates are cut to YYYY-MM-DD. No limit is forced here so
 * cursor paging can slice the full sorted list.
 */
export function createScraperFetcher(
	options: ScraperFetchOptions,
	run: ScraperRunner = defaultScraperRunner(options.adapters),
): PostingFetcher {
	return async (query: string) => {
		const jobs = await run({
			keywords: query,
			location: options.location,
		});
		return jobs.map((job) => ({
			title: job.title,
			company: job.company,
			url: job.url,
			description: job.description,
			postedDate: job.postedAt ? job.postedAt.toISOString().slice(0, 10) : undefined,
			portal: job.source,
			...(job.location !== undefined ? { location: job.location } : {}),
			...(job.remote !== undefined ? { remote: job.remote } : {}),
		}));
	};
}
