import type { McpServer } from "@modelcontextprotocol/server";

import { jobHunterAppMeta } from "@/lib/job-hunter/ui.ts";

import { loadActiveProfile } from "@/lib/job-hunter/request-profile.ts";
import { planSearch } from "@/lib/job-hunter/search.ts";
import { SearchJobsInput, SearchJobsOutput } from "@/lib/job-hunter/schemas/search-jobs.ts";

export function registerSearchJobs(server: McpServer): void {
	server.registerTool(
		"search-jobs",
		{
			title: "Search jobs",
			description:
				"Finds fresh postings through the local scraper adapters (Indeed/LinkedIn Site clients plus remote and Nigerian boards; always runs all adapters), with explicit filters (keywords, location, remote mode, job type, limit capped at 20) or profile-derived auto-queries, scoped to the last 14 days with unknown dates flagged. Never invents postings and never scrapes people-search pages. Runs the query set up to a visible cap and reports queriesRun; returns stability-ready keys. The host owns all writes to the seen store and tracker. Token budget: the model decides keywords, location, mode, and limit only. Large result sets page via the opaque next cursor; the server holds no state.",
			inputSchema: SearchJobsInput,
			outputSchema: SearchJobsOutput,
			...jobHunterAppMeta(),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async (input, extra) => {
			const profile = await loadActiveProfile(extra);
			const plan = await planSearch({
				filters: {
					keywords: input.keywords,
					location: input.location,
					remoteMode: input.remoteMode,
					jobType: input.jobType,
					limit: input.limit,
				},
				profile,
				scraperAdapters: ["all"],
				cursor: input.cursor,
			});
			return {
				content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
				structuredContent: { ...plan },
			};
		},
	);
}
