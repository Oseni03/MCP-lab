import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import type { McpServer } from "@modelcontextprotocol/server";

import { registerAnalyzeJob } from "@/lib/job-hunter/tools/analyze-job.ts";
import { EvaluationSchema } from "@/lib/job-hunter/schemas/analyze-job.ts";

function capture(register: (server: McpServer) => void) {
	const captured: { name: string; handler: (input: any, extra: any) => Promise<any> }[] = [];
	const server = {
		registerTool(name: string, _config: unknown, handler: any) {
			captured.push({ name, handler });
		},
	} as unknown as McpServer;
	register(server);
	return captured;
}

const GROQ_OK = JSON.stringify({
	choices: [{ message: { content: JSON.stringify({ strengths: ["Python"], gaps: ["K8s"], recommendation: "Apply" }) } }],
});

describe("analyze-job tool (Groq-only)", () => {
	let savedKey: string | undefined;
	beforeEach(() => {
		savedKey = process.env.GROQ_API_KEY;
	});
	afterEach(() => {
		if (savedKey === undefined) delete process.env.GROQ_API_KEY;
		else process.env.GROQ_API_KEY = savedKey;
	});

	it("registers under analyze-job", () => {
		const tools = capture((s) => registerAnalyzeJob(s));
		assert.equal(tools.length, 1);
		assert.equal(tools[0].name, "analyze-job");
	});

	it("exposes the thin detail+fit contract", () => {
		const shape = EvaluationSchema.shape;
		assert.ok("detail" in shape);
		assert.ok("fit" in shape);
		assert.ok("refinement" in shape);
		assert.ok(!("companyResearch" in shape), "company research removed");
		assert.ok(!("dimensions" in shape), "heuristic dimensions removed from top level");
	});

	it("errors when neither jobUrl nor postingText is given", async () => {
		const [tool] = capture((s) => registerAnalyzeJob(s));
		const res = await tool.handler({}, {});
		assert.equal(res.isError, true);
	});

	it("errors honestly when GROQ_API_KEY is missing (no silent fallback)", async () => {
		delete process.env.GROQ_API_KEY;
		const [tool] = capture((s) => registerAnalyzeJob(s));
		const res = await tool.handler({ postingText: "Python role with K8s." }, {});
		assert.equal(res.isError, true);
		assert.match(String(res.content[0].text), /GROQ_API_KEY/);
	});

	it("returns detail+groq fit for pasted text with a stubbed Groq fetch", async () => {
		process.env.GROQ_API_KEY = "test-key";
		const fetchImpl = async () => ({ status: 200, body: GROQ_OK });
		const [tool] = capture((s) => registerAnalyzeJob(s, { fetchImpl }));
		const res = await tool.handler({ postingText: "Senior Python engineer. Must know K8s." }, {});
		assert.equal(res.isError, undefined);
		const parsed = EvaluationSchema.safeParse(res.structuredContent);
		assert.equal(parsed.success, true);
		assert.equal(res.structuredContent.refinement.source, "groq");
		assert.deepEqual(res.structuredContent.fetchSteps, ["pasted-text"]);
	});
});
