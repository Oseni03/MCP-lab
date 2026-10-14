import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { McpServer } from "@modelcontextprotocol/server";

import { registerSearchJobs } from "@/lib/job-hunter/tools/search-jobs.ts";
import { SearchJobsOutput } from "@/lib/job-hunter/schemas/search-jobs.ts";

function registered(): { name: string; handler: unknown }[] {
	const captured: { name: string; handler: unknown }[] = [];
	const server = {
		registerTool(name: string, _config: unknown, handler: unknown) {
			captured.push({ name, handler });
		},
	} as unknown as McpServer;
	registerSearchJobs(server);
	return captured;
}

describe("search-jobs tool", () => {
	it("registers under search-jobs", () => {
		const tools = registered();
		assert.equal(tools.length, 1);
		assert.equal(tools[0].name, "search-jobs");
	});

	it("exposes the thin Remotive-only output contract", () => {
		const shape = SearchJobsOutput.shape;
		assert.ok("jobs" in shape, "thin jobs list present");
		assert.ok("nextCursor" in shape, "cursor present");
		assert.ok(!("candidates" in shape), "old candidates removed");
		assert.ok(!("queriesRun" in shape), "old queriesRun removed");
		assert.ok(!("quickFit" in shape), "no scoring at top level");
	});
});
