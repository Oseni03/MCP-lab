import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	EMPTY_HTML_ERROR,
	EMPTY_VERSION_KEY_ERROR,
	fetchLatestResumeVersion,
	fetchResumeVersions,
	saveResumeVersion,
	toReviewMarkdown,
} from "@/lib/job-hunter/resume-version.ts";

const HTML = "<!doctype html><html><body><h2>Experience</h2><p>Cut losses by 12%.</p></body></html>";

describe("resumeversion persistence (ticket 02)", () => {
	it("derives review markdown prose from HTML without inventing text", () => {
		const markdown = toReviewMarkdown(HTML);
		assert.ok(!markdown.includes("<"));
		assert.ok(markdown.includes("Cut losses by 12"));
	});

	it("fails loudly on empty source", async () => {
		const result = await saveResumeVersion(null, { userId: "u", jobKey: "k", html: "  \n " });
		assert.equal(result.persisted, false);
		assert.ok(result.reason.includes(EMPTY_HTML_ERROR));
	});

	it("fails loudly on empty user or key", async () => {
		const result = await saveResumeVersion(null, { userId: " ", jobKey: "k", html: HTML });
		assert.equal(result.persisted, false);
		assert.ok(result.reason.includes(EMPTY_VERSION_KEY_ERROR));
	});

	it("degrades gracefully without a database", async () => {
		assert.deepEqual(await saveResumeVersion(null, { userId: "u", jobKey: "k", html: HTML }), {
			persisted: false,
			reason: "no-database",
		});
		assert.deepEqual(await fetchResumeVersions(null, "u", "k"), []);
		assert.equal(await fetchLatestResumeVersion(null, "u", "k"), null);
	});
});
