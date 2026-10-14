import { remotive } from "@/host/job-hunter/scraper/adapters/remotive.ts";
import type { Job as ScrapedJob } from "@/host/job-hunter/scraper/types.ts";
import { decodeCursor, encodeCursor } from "@/lib/cursor.ts";

/**
 * Thin Remotive-only job discovery: one keyword query in, newest-first
 * thin list out. No scoring, no snippets. The limit is the page size with
 * an opaque offset cursor; the server holds no state.
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
export function resolveSearchFilters(filters: SearchFilters | undefined): ResolvedFilters {
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

function toThinJob(job: ScrapedJob): ThinJob | null {
	const url = job.url.split("#")[0].trim();
	try {
		const protocol = new URL(url).protocol;
		if (protocol !== "http:" && protocol !== "https:") return null;
	} catch {
		return null;
	}
	return {
		id: job.id,
		title: job.title,
		company: job.company,
		url,
		location: job.location?.trim() ? job.location.trim() : null,
		postedAt: job.postedAt ? job.postedAt.toISOString().slice(0, 10) : null,
		remote: true,
	};
}

export async function planSearch(input: SearchInput): Promise<SearchPlan> {
	const filters = resolveSearchFilters(input.filters);
	const notes: string[] = [];
	const errors: string[] = [];

	const decoded = decodeCursor(input.cursor);
	const offset = decoded ?? 0;
	if (input.cursor !== undefined && decoded === null) {
		notes.push("Unparseable page cursor ignored; restarted at offset zero (correctness first).");
	}

	const scraped = await remotive
		.search({ keywords: filters.keywords, location: filters.location })
		.catch((error) => {
			errors.push(`Scraper fetch failed for "${filters.keywords}" (${String(error)}); no postings invented.`);
			return null;
		});
	if (scraped === null) {
		return { filters, jobs: [], nextCursor: null, notes, errors };
	}
	notes.push(`Remotive-only run for "${filters.keywords || "(all)"}"; single query.`);

	const mapped = scraped.map(toThinJob);
	const dropped = mapped.filter((job) => job === null).length;
	if (dropped > 0) {
		errors.push(`Dropped ${dropped} posting(s) with unresolvable URLs; nothing invented.`);
	}
	const jobs = mapped.filter((job) => job !== null);

	const seen = new Set<string>();
	const deduped = jobs.filter((job) => {
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
