import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { McpServer } from "@modelcontextprotocol/server";

import {
	buildResumeVerification,
	buildTailorEventNote,
	logTailorEvent,
} from "@/lib/job-hunter/resume-version.ts";
import { registerTailorResume } from "@/lib/job-hunter/tools/tailor-resume.ts";
import { sectionHeadings } from "@/lib/job-hunter/document.ts";
import type { FetchLike } from "@/lib/job-hunter/fetch-posting.ts";

type ToolResult = {
	content: { type: string; text: string }[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

function toolHandler(register: (server: McpServer) => void) {
	const captured: unknown[] = [];
	const server = {
		registerTool(_name: string, _config: unknown, handler: unknown) {
			captured.push(handler);
		},
	} as unknown as McpServer;
	register(server);
	return captured[0] as (input: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
}

const POSTING = ["Senior ML Engineer at Acme.", "Requirements: Python, SQL."].join("\n");

describe("resumeversion verification (ticket 03)", () => {
	it("scores full matches as overlap 1 with no invented employers", () => {
		const verification = buildResumeVerification({
			coverage: [{ status: "matched" }, { status: "matched" }, { status: "gap" }],
			draftDrift: [],
			renderSafetyPassed: true,
		});
		assert.deepEqual(verification, { compiles: true, keywordOverlap: 0.67, noNewEmployers: true });
	});

	it("fails loudly on drift and empty coverage", () => {
		const verification = buildResumeVerification({
			coverage: [],
			draftDrift: ["unverified employer claim"],
			renderSafetyPassed: false,
		});
		assert.deepEqual(verification, { compiles: false, keywordOverlap: 0, noNewEmployers: false });
	});

	it("keeps the event note to slugs and counts, never contact text", () => {
		const note = buildTailorEventNote({
			slug: "acme_senior-ml-engineer",
			verification: { compiles: true, keywordOverlap: 1, noNewEmployers: true },
			driftCount: 0,
			stretchCount: 1,
			stored: true,
		});
		assert.ok(note.includes("acme_senior-ml-engineer"));
		assert.ok(!note.includes("@"));
		assert.ok(!/\d{8,}/.test(note));
	});

	it("degrades event logging without a database", async () => {
		assert.deepEqual(await logTailorEvent(null, { userId: "u", ok: true, note: "n" }), {
			logged: false,
			reason: "no-database",
		});
	});

	it("returns verification with the tailoring without failing anonymous callers", async () => {
		const render = {
			name: "Test Candidate",
			statement: "Test Candidate brings Python and SQL to ML Engineer work.",
			competencies: [{ label: "Python", body: "Direct match to a stated requirement." }],
			headings: sectionHeadings("en"),
		};
		const fetchImpl: FetchLike = async () => ({
			status: 200,
			body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(render) } }] }),
		});
		const hadKey = process.env["GROQ_API_KEY"];
		process.env["GROQ_API_KEY"] = "test-key";
		let result: ToolResult;
		try {
			result = await toolHandler((server) => registerTailorResume(server, { fetchImpl }))(
				{ postingText: POSTING, company: "Acme", role: "Senior ML Engineer" },
				{},
			);
		} finally {
			if (hadKey === undefined) delete process.env["GROQ_API_KEY"];
			else process.env["GROQ_API_KEY"] = hadKey;
		}
		assert.equal(result.isError, undefined);
		const verification = (result.structuredContent as Record<string, unknown>)[
			"verification"
		] as Record<string, unknown>;
		assert.equal(typeof verification["compiles"], "boolean");
		assert.equal(typeof verification["keywordOverlap"], "number");
		assert.equal(typeof verification["noNewEmployers"], "boolean");
		assert.equal(
			(result.structuredContent as Record<string, unknown>)["versionId"],
			undefined,
			"anonymous callers store nothing",
		);
	});
});
