import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/server";

import { resolveActiveProfile } from "@/lib/job-hunter/request-profile.ts";
import { registerAnalyzeJob } from "@/lib/job-hunter/tools/analyze-job.ts";
import { registerTailorResume } from "@/lib/job-hunter/tools/tailor-resume.ts";
import { registerGenerateCoverLetter } from "@/lib/job-hunter/tools/generate-cover-letter.ts";
import { registerSearchJobs } from "@/lib/job-hunter/tools/search-jobs.ts";
import { registerSetupProfile } from "@/lib/job-hunter/tools/setup-profile.ts";
import { registerJobHunterAppResource } from "@/lib/job-hunter/ui.ts";
import { getPrompt, getResource, listPrompts, listResources, renderProfileResource } from "@/lib/job-hunter/resources.ts";

/**
 * Composition root for the job-hunter MCP (served at /job-hunter/mcp).
 * Platform auth plumbing lives in lib/mcp/; everything product-specific
 * lives here and under lib/job-hunter/.
 */
export function registerJobHunterTools(server: McpServer): void {
	registerAnalyzeJob(server);
	registerTailorResume(server);
	registerGenerateCoverLetter(server);
	registerSearchJobs(server);
	registerSetupProfile(server);
	registerJobHunterAppResource(server);
}

/**
 * Versioned resources and prompts. Private server defaults stay embedded
 * and versioned; the candidate-profile resource renders the caller's
 * stored profile per request (embedded defaults when none is stored).
 * Tools load the same stored profile instead of accepting one.
 */
export function registerJobHunterResources(server: McpServer): void {
	for (const descriptor of listResources()) {
		server.registerResource(
			descriptor.name,
			descriptor.uri,
			{
				title: `${descriptor.title} (v${descriptor.version})`,
				description: descriptor.description,
				mimeType: descriptor.mimeType,
			},
			async (uri, ctx) => {
				if (descriptor.name === "candidate-profile") {
					const resolved = await resolveActiveProfile(ctx);
					return {
						contents: [
							{
								uri: uri.href,
								mimeType: descriptor.mimeType,
								text: renderProfileResource(resolved.profile, resolved.stored),
							},
						],
					};
				}
				const read = getResource(descriptor.uri);
				const text = read.ok ? read.text : read.error;
				return {
					contents: [{ uri: uri.href, mimeType: descriptor.mimeType, text }],
				};
			},
		);
	}
	for (const descriptor of listPrompts()) {
		server.registerPrompt(
			descriptor.name,
			{
				title: `${descriptor.title} (v${descriptor.version})`,
				description: descriptor.description,
			},
			async () => {
				const read = getPrompt(descriptor.name);
				const text = read.ok ? read.text : read.error;
				return {
					messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
				};
			},
		);
	}
}

export function buildJobHunterHandler(): (req: Request) => Promise<Response> {
	return createMcpHandler((server) => {
		registerJobHunterTools(server);
		registerJobHunterResources(server);
	});
}
