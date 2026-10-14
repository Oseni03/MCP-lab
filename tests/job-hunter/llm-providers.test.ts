import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildTailorPrompt, groqRefine, groqTailor, refineEvaluation, samplingRefine } from "@/lib/job-hunter/llm.ts";
import { sectionHeadings } from "@/lib/job-hunter/document.ts";
import type { FetchLike } from "@/lib/job-hunter/fetch-posting.ts";
import { evaluateJob } from "@/lib/job-hunter/evaluate.ts";
import type { Profile } from "@/lib/job-hunter/profile.ts";
import { DEFAULT_PROFILE } from "@/lib/job-hunter/profile.ts";

const PROFILE: Profile = {
	...DEFAULT_PROFILE,
	name: "Test Candidate",
	skills: [{ name: "Python", category: "primary" as const }],
	languages: [{ language: "English", level: "C1" }],
};

const POSTING = "Python role.\nRequirements: Python.\nWe welcome international applicants.";

function mockFetch(
	handler: (
		url: string,
		headers: Record<string, string>,
		init?: { method?: string; body?: string },
	) => { status: number; body: string },
): { fetchImpl: FetchLike; seen: Array<{ url: string; headers: Record<string, string>; body?: string }> } {
	const seen: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
	const fetchImpl: FetchLike = async (url, headers = {}, init) => {
		seen.push({ url, headers, body: init?.body });
		return handler(url, headers, init);
	};
	return { fetchImpl, seen };
}

describe("groqRefine", () => {
	it("posts JSON mode and returns the parsed content", async () => {
		const { fetchImpl, seen } = mockFetch(() => ({
			status: 200,
			body: JSON.stringify({ choices: [{ message: { content: '{"dimensions":[]}' } }] }),
		}));
		const result = await groqRefine("prompt", { apiKey: "key-1", model: "test-model", fetchImpl });
		assert.deepEqual(result, { dimensions: [] });
		assert.equal(seen.length, 1);
		assert.equal(seen[0].url, "https://api.groq.com/openai/v1/chat/completions");
		assert.equal(seen[0].headers["Authorization"], "Bearer key-1");
		const sent = JSON.parse(seen[0].body ?? "{}");
		assert.equal(sent.model, "test-model");
		assert.deepEqual(sent.response_format, { type: "json_object" });
	});

	it("throws on a non-200 response", async () => {
		const { fetchImpl } = mockFetch(() => ({ status: 401, body: "unauthorized" }));
		await assert.rejects(() => groqRefine("prompt", { apiKey: "bad", fetchImpl }));
	});

	it("returns raw text when the content is not JSON", async () => {
		const { fetchImpl } = mockFetch(() => ({
			status: 200,
			body: JSON.stringify({ choices: [{ message: { content: "oops" } }] }),
		}));
		assert.equal(await groqRefine("prompt", { apiKey: "key-1", fetchImpl }), "oops");
	});
});

describe("samplingRefine", () => {
	it("sends a sampling request and parses the text content", async () => {
		const seen: Array<{ method: string; params: unknown }> = [];
		const result = await samplingRefine("prompt", async (method, params) => {
			seen.push({ method, params });
			return { model: "host-model", content: { type: "text", text: '{"strengths":["x"]}' } };
		});
		assert.deepEqual(result, { parsed: { strengths: ["x"] }, model: "host-model" });
		assert.equal(seen[0].method, "sampling/createMessage");
	});

	it("throws on an unexpected result shape", async () => {
		await assert.rejects(() => samplingRefine("prompt", async () => ({ nope: true })));
	});
});

describe("refineEvaluation", () => {
	it("uses sampling first when it succeeds", async () => {
		const base = evaluateJob({ postingText: POSTING, profile: PROFILE });
		const outcome = await refineEvaluation(base, POSTING, PROFILE, {
			samplingSender: async () => ({ content: { type: "text", text: '{"gaps":["none"]}' } }),
			groqApiKey: "key-1",
			fetchImpl: async () => {
				throw new Error("groq must not be called");
			},
		});
		assert.equal(outcome.source, "sampling");
		assert.deepEqual(outcome.evaluation.gaps, ["none"]);
	});

	it("falls back to Groq when sampling fails", async () => {
		const base = evaluateJob({ postingText: POSTING, profile: PROFILE });
		const { fetchImpl } = mockFetch(() => ({
			status: 200,
			body: JSON.stringify({ choices: [{ message: { content: '{"gaps":["groq-gap"]}' } }] }),
		}));
		const outcome = await refineEvaluation(base, POSTING, PROFILE, {
			samplingSender: async () => {
				throw new Error("no sampling support");
			},
			groqApiKey: "key-1",
			model: "test-model",
			fetchImpl,
		});
		assert.equal(outcome.source, "groq");
		assert.equal(outcome.model, "test-model");
		assert.deepEqual(outcome.evaluation.gaps, ["groq-gap"]);
	});

	it("keeps the heuristic scaffold when every provider fails", async () => {
		const base = evaluateJob({ postingText: POSTING, profile: PROFILE });
		const { fetchImpl } = mockFetch(() => ({ status: 500, body: "boom" }));
		const outcome = await refineEvaluation(base, POSTING, PROFILE, {
			samplingSender: async () => {
				throw new Error("no sampling support");
			},
			groqApiKey: "key-1",
			fetchImpl,
		});
		assert.equal(outcome.source, "heuristic");
		assert.deepEqual(outcome.evaluation, base);
		assert.match(outcome.note, /heuristic/i);
	});

	it("skips providers entirely in off mode", async () => {
		const base = evaluateJob({ postingText: POSTING, profile: PROFILE });
		let called = false;
		const outcome = await refineEvaluation(base, POSTING, PROFILE, {
			mode: "off",
			samplingSender: async () => {
				called = true;
				return {};
			},
			groqApiKey: "key-1",
			fetchImpl: async () => {
				called = true;
				return { status: 200, body: "{}" };
			},
		});
		assert.equal(outcome.source, "heuristic");
		assert.equal(called, false);
	});

	it("skips providers when the profile carries no scoring signal", async () => {
		const base = evaluateJob({ postingText: POSTING, profile: DEFAULT_PROFILE });
		assert.equal(base.scored, false);
		let called = false;
		const outcome = await refineEvaluation(base, POSTING, DEFAULT_PROFILE, {
			samplingSender: async () => {
				called = true;
				return {};
			},
			groqApiKey: "key-1",
			fetchImpl: async () => {
				called = true;
				return { status: 200, body: "{}" };
			},
		});
		assert.equal(outcome.source, "heuristic");
		assert.equal(called, false);
		assert.equal(outcome.evaluation.scored, false);
		assert.equal(outcome.evaluation.overallScore, null);
	});
});

describe("groqTailor", () => {
	it("posts JSON mode and returns the parsed content", async () => {
		const { fetchImpl, seen } = mockFetch(() => ({
			status: 200,
			body: JSON.stringify({ choices: [{ message: { content: '{"statement":"x"}' } }] }),
		}));
		const result = await groqTailor("prompt", { apiKey: "key-1", model: "test-model", fetchImpl });
		assert.deepEqual(result, { statement: "x" });
		assert.equal(seen[0].url, "https://api.groq.com/openai/v1/chat/completions");
		const sent = JSON.parse(seen[0].body ?? "{}");
		assert.equal(sent.model, "test-model");
		assert.deepEqual(sent.response_format, { type: "json_object" });
	});

	it("throws on a non-200 response", async () => {
		const { fetchImpl } = mockFetch(() => ({ status: 500, body: "boom" }));
		await assert.rejects(() => groqTailor("prompt", { apiKey: "key-1", fetchImpl }));
	});
});

describe("buildTailorPrompt", () => {
	it("carries the profile, fenced posting, target, and verbatim headings", () => {
		const headings = sectionHeadings("en");
		const prompt = buildTailorPrompt("Requirements: Python.\n```evil```", PROFILE, {
			company: "Acme",
			role: "ML Engineer",
			headings,
		});
		assert.ok(prompt.includes('"Python"'));
		assert.ok(prompt.includes("Acme"));
		assert.ok(prompt.includes("ML Engineer"));
		assert.ok(prompt.includes(JSON.stringify(headings)));
		assert.ok(!prompt.includes("```evil```"));
		assert.ok(prompt.includes("```POSTING"));
	});
});
