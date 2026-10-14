#!/usr/bin/env node
/**
 * Thin Remotive-only debug CLI (locked spec Q14):
 * MCP-only product; this CLI stays for debugging only.
 *
 *   node host/job-hunter/scraper/cli.ts search --location "<place>" [flags]
 *   node host/job-hunter/scraper/cli.ts detail <url> [--format json|plain]
 *   node host/job-hunter/scraper/cli.ts sources [--format json|table|plain]
 *
 * Results print to stdout (JSON by default). Failures print
 * { "error": "...", "code": "..." } to stderr and exit 1.
 */
import { pathToFileURL } from "node:url";
import { adapters, searchAll, searchSource } from "./index.ts";
import { clearHttpCache } from "./http.ts";
import { fetchJobDetailText, fetchPageDetail, isEnrichable } from "./detail.ts";
import type { Job, JobDetail, RemoteFilter, SearchQuery } from "./types.ts";

type Format = "json" | "table" | "plain";

export interface SearchOptions {
	location: string;
	query: string;
	jobageDays?: number;
	jobageMinutes?: number;
	remote?: RemoteFilter;
	page: number;
	limit?: number;
	source: string;
	format: Format;
	enrich: boolean;
}

export interface DetailOptions {
	target: string;
	format: Format;
}

export class CliError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "CliError";
		this.code = code;
	}
}

function takeValue(args: string[], index: number, flag: string): { value: string; next: number } {
	const value = args[index];
	if (value === undefined || value.startsWith("-")) {
		throw new CliError("bad-args", `${flag} requires a value.`);
	}
	return { value, next: index + 1 };
}

function takePositiveInt(raw: string, flag: string): number {
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new CliError("bad-args", `${flag} must be a positive integer, got ${JSON.stringify(raw)}.`);
	}
	return value;
}

function parseFormat<T extends Format>(raw: string | undefined, allowed: T[], fallback: T): T {
	if (!raw) return fallback;
	if ((allowed as string[]).includes(raw)) return raw as T;
	throw new CliError("bad-args", `--format must be one of ${allowed.join("|")}, got ${JSON.stringify(raw)}.`);
}

export function parseArgs(argv: string[]):
	| { command: "search"; options: SearchOptions }
	| { command: "detail"; options: DetailOptions }
	| { command: "sources"; options: { format: Format } } {
	const [command, ...rest] = argv;
	if (!command || command === "--help" || command === "-h") return printHelpAndExit();
	if (command !== "search" && command !== "detail" && command !== "sources") {
		throw new CliError("bad-args", `Unknown command ${JSON.stringify(command)}. See --help.`);
	}

	if (command === "sources") {
		let format: string | undefined;
		for (let i = 0; i < rest.length; i += 1) {
			const arg = rest[i] as string;
			if (arg === "--format" || arg === "-f") {
				const taken = takeValue(rest, i + 1, "--format");
				format = taken.value;
				i = taken.next - 1;
			} else {
				throw new CliError("bad-args", `Unexpected argument ${JSON.stringify(arg)} for sources.`);
			}
		}
		return { command: "sources", options: { format: parseFormat(format, ["json", "table", "plain"], "json") } };
	}

	if (command === "detail") {
		let target: string | undefined;
		let format: string | undefined;
		for (let i = 0; i < rest.length; i += 1) {
			const arg = rest[i] as string;
			if (arg === "--format" || arg === "-f") {
				const taken = takeValue(rest, i + 1, "--format");
				format = taken.value;
				i = taken.next - 1;
			} else if (arg.startsWith("-")) {
				throw new CliError("bad-args", `Unknown flag ${JSON.stringify(arg)} for detail.`);
			} else if (!target) {
				target = arg;
			} else {
				throw new CliError("bad-args", `Unexpected argument ${JSON.stringify(arg)} for detail.`);
			}
		}
		if (!target) throw new CliError("bad-args", "detail requires a job id or URL.");
		return { command: "detail", options: { target, format: parseFormat(format, ["json", "plain"], "json") } };
	}

	const options: SearchOptions = { location: "", query: "", page: 1, source: "all", format: "json", enrich: false };
	for (let i = 0; i < rest.length; i += 1) {
		const arg = rest[i] as string;
		const [flag, inline] = arg.split("=", 2);
		const readValue = (name: string): string => {
			if (inline !== undefined) return inline;
			const taken = takeValue(rest, i + 1, name);
			i = taken.next - 1;
			return taken.value;
		};
		switch (flag) {
			case "--location":
			case "-l":
				options.location = readValue("--location");
				break;
			case "--query":
			case "-q":
				options.query = readValue("--query");
				break;
			case "--jobage":
				options.jobageDays = takePositiveInt(readValue("--jobage"), "--jobage");
				break;
			case "--jobage-minutes":
				options.jobageMinutes = takePositiveInt(readValue("--jobage-minutes"), "--jobage-minutes");
				break;
		case "--remote": {
			const value = readValue("--remote");
			if (value !== "remote" && value !== "hybrid" && value !== "onsite") {
				throw new CliError("bad-args", `--remote must be remote|hybrid|onsite, got ${JSON.stringify(value)}.`);
			}
			options.remote = value;
			break;
		}
		case "--country":
			throw new CliError("bad-args", "--country was removed with the multi-board scraper (Remotive-only now).");
			break;
			case "--page":
				options.page = takePositiveInt(readValue("--page"), "--page");
				break;
			case "--limit":
			case "-n":
				options.limit = takePositiveInt(readValue("--limit"), "--limit");
				break;
			case "--source":
			case "-s":
				options.source = readValue("--source");
				break;
			case "--format":
			case "-f":
				options.format = parseFormat(readValue("--format"), ["json", "table", "plain"], "json");
				break;
			case "--enrich":
				options.enrich = true;
				break;
			default:
				throw new CliError("bad-args", `Unknown argument ${JSON.stringify(arg)} for search. See --help.`);
		}
	}

	if (!options.location.trim()) throw new CliError("bad-args", "--location is required for search.");
	if (options.jobageDays !== undefined && options.jobageMinutes !== undefined) {
		throw new CliError("bad-args", "--jobage and --jobage-minutes conflict; pass only one.");
	}
	return { command: "search", options };
}

function printHelpAndExit(): never {
	const help = [
		"Usage:",
		'  node host/job-hunter/scraper/cli.ts search --location "<place>" [flags]',
		"  node host/job-hunter/scraper/cli.ts detail <url> [--format json|plain]",
		"  node host/job-hunter/scraper/cli.ts sources [--format json|table|plain]",
		"",
		"Search flags: --location/-l (required), --query/-q, --jobage days,",
		"  --jobage-minutes (conflicts with --jobage), --remote remote|hybrid|onsite,",
		"  --page (1-indexed), --limit/-n, --source/-s (default all = remotive),",
		"  --format/-f json|table|plain, --enrich (re-fetch when description is missing).",
		"",
		"Remotive-only debug CLI. Responses are cached on disk (.scratch/scrape-cache).",
		"Repeat runs are instant until entries expire.",
	].join("\n");
	process.stdout.write(`${help}\n`);
	process.exit(0);
}

function formatDate(value?: Date): string {
	return value ? value.toISOString().slice(0, 10) : "unknown";
}

function padEnd(value: string, width: number): string {
	const text = value.length > width ? `${value.slice(0, width - 1)}…` : value;
	return text.padEnd(width, " ");
}

export function formatJobs(jobs: Job[], format: Format): string {
	if (format === "json") return JSON.stringify(jobs, null, 2);
	if (jobs.length === 0) return "No jobs found.";
	if (format === "plain") {
		return jobs
			.map((job) => [`${job.title} @ ${job.company}`, `  ${job.location ?? "location unknown"} | posted ${formatDate(job.postedAt)}`, `  ${job.url}`].join("\n"))
			.join("\n\n");
	}
	const rows = jobs.map((job) => [
		job.title,
		job.company,
		job.location ?? "?",
		formatDate(job.postedAt),
		job.url,
	]);
	const widths = [42, 26, 24, 10, 50];
	const header = ["Title", "Company", "Location", "Posted", "URL"].map((h, i) => padEnd(h, widths[i] as number)).join("  ");
	const lines = rows.map((row) => row.map((cell, i) => padEnd(cell, widths[i] as number)).join("  "));
	return [header, ...lines].join("\n");
}

export function formatDetail(detail: JobDetail, format: Format): string {
	if (format === "json") return JSON.stringify(detail, null, 2);
	const meta = [
		`${detail.title} @ ${detail.company}`,
		`${detail.location ?? "location unknown"} | ${detail.url}`,
		[detail.seniority, detail.employmentType, detail.jobFunction, detail.industries?.join(", ")].filter(Boolean).join(" | "),
		"",
		detail.description,
	].filter((line) => line !== undefined);
	return meta.join("\n");
}

export function formatSources(format: Format): string {
	// Ticket 04 removed the board adapters and their token config; every
	// remaining adapter runs without configuration. Full CLI resync (ticket 05).
	const rows = adapters.map((adapter) => ({
		name: adapter.name,
		needsConfig: false,
	}));
	if (format === "json") return JSON.stringify(rows, null, 2);
	if (format === "plain") {
		return rows.map((row) => row.name).join("\n");
	}
	return ["Name  Needs config", ...rows.map((row) => `${padEnd(row.name, 6)}${row.needsConfig ? "yes" : "no"}`)].join("\n");
}

export function toSearchQuery(options: SearchOptions): SearchQuery {
	return {
		keywords: options.query,
		location: options.location,
		remoteFilter: options.remote,
		postedWithinDays: options.jobageDays,
		postedWithinMinutes: options.jobageMinutes,
		page: options.page,
		limit: options.limit,
	};
}

export async function runSearch(options: SearchOptions): Promise<Job[]> {
	const query = toSearchQuery(options);
	const jobs = options.source === "all" ? await searchAll(query) : await searchSource(options.source, query);
	if (options.enrich) await enrichJobs(jobs);
	return jobs;
}

/**
 * Fill in missing descriptions (Remotive search hits already carry full
 * descriptions; re-fetch only when empty). Bounded concurrency, failures
 * keep the existing text, and the 7-day detail cache makes repeats free.
 */
export async function enrichJobs(jobs: Job[], concurrency = 4): Promise<void> {
	let index = 0;
	const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
		while (index < jobs.length) {
			const job = jobs[index] as Job;
			index += 1;
			if (!isEnrichable(job)) continue;
			try {
				const description = await fetchJobDetailText(job);
				if (description) job.description = description;
			} catch {
				// keep the snippet on fetch failure
			}
		}
	});
	await Promise.all(workers);
}

export async function runDetail(target: string): Promise<JobDetail> {
	if (/^https?:\/\//i.test(target)) {
		try {
			return await fetchPageDetail(target);
		} catch (error) {
			throw new CliError("fetch-failed", error instanceof Error ? error.message : String(error));
		}
	}
	throw new CliError("bad-args", `Cannot parse ${JSON.stringify(target)} as a URL.`);
}

export async function main(argv: string[]): Promise<number> {
	try {
		const parsed = parseArgs(argv);
		if (parsed.command === "search") {
			const jobs = await runSearch(parsed.options);
			process.stdout.write(`${formatJobs(jobs, parsed.options.format)}\n`);
		} else if (parsed.command === "detail") {
			const detail = await runDetail(parsed.options.target);
			process.stdout.write(`${formatDetail(detail, parsed.options.format)}\n`);
		} else {
			process.stdout.write(`${formatSources(parsed.options.format)}\n`);
		}
		return 0;
	} catch (error) {
		const code = error instanceof CliError ? error.code : "fetch-failed";
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${JSON.stringify({ error: message, code })}\n`);
		return 1;
	} finally {
		clearHttpCache();
	}
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
	process.exit(await main(process.argv.slice(2)));
}
