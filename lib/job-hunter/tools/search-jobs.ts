import type { McpServer } from "@modelcontextprotocol/server";

import { jobHunterAppMeta } from "@/lib/job-hunter/ui.ts";

import { planSearch } from "@/lib/job-hunter/search.ts";
import { SearchJobsInput, SearchJobsOutput } from "@/lib/job-hunter/schemas/search-jobs.ts";

export function registerSearchJobs(server: McpServer): void {
	server.registerTool(
		"search-jobs",
		{
			title: "Search jobs",
			description:
				"Thin Remotive-only list scrape: one keyword query (?search=) with client-side location filter, newest-first thin jobs (id/title/company/url/location/postedAt/remote, no snippets, no scores). Limit is the page size (default 10, max 20); large sets page via the opaque next cursor; the server holds no state. Never invents postings.",
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
		async (input) => {
			const plan = await planSearch({
				filters: {
					keywords: input.keywords,
					location: input.location,
					limit: input.limit,
				},
				scraperAdapters: ["remotive"],
				cursor: input.cursor,
			});
			return {
				content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
				structuredContent: { ...plan },
			};
		},
	);
}
