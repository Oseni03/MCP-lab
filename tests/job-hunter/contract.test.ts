import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { TRACKER_HEADER, planRecordApplication } from "@/lib/job-hunter/record.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LIB = new URL("../../lib/", import.meta.url);

function libFiles(dir: URL): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory()) {
			files.push(...libFiles(new URL(`${entry.name}/`, dir)));
		} else if (entry.name.endsWith(".ts")) {
			files.push(join(fileURLToPath(dir), entry.name));
		}
	}
	return files;
}

describe("store portability", () => {
	it("keeps the record payload plain JSON for a later key-value, relational, or blob store", () => {
		const result = planRecordApplication({
			company: "Acme",
			role: "Senior ML Engineer",
			fitScore: 84,
			cvFile: "cv/main_acme_senior-ml-engineer.tex",
			coverLetterFile: "cover_letters/cover_acme_senior-ml-engineer.tex",
			postingUrl: "https://example.com/jobs/1",
			deadline: "2026-04-01",
			postingText: "Senior ML Engineer at Acme.",
			trackerText: "",
			today: "2026-03-01",
		});
		assert.equal(result.ok, true);
		const { ok: _ok, ...payload } = result;
		assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload, "no schema churn: plain data round-trips");
	});
});

describe("write contracts", () => {
	it("performs no filesystem writes anywhere in lib/; the host owns every write", () => {
		const writers = /writeFileSync|appendFileSync|mkdirSync|rmSync|createWriteStream|copyFileSync/;
		const offenders = libFiles(LIB).filter((file) => writers.test(readFileSync(file, "utf-8")));
		assert.deepEqual(offenders, [], `server-side writers found: ${offenders.join(", ")}`);
	});

	it("never touches the dedup store from the record path", () => {
		const storeTouch = /seenKeys|seenSkipped|seen\.has|seen\.add|seenStore/i;
		for (const file of ["job-hunter/record.ts"]) {
			const text = readFileSync(new URL(file, LIB), "utf-8");
			assert.ok(!storeTouch.test(text), `${file} must not interact with the seen store`);
		}
	});
});

describe("tracker contract", () => {
	it("matches the tracker header exactly", () => {
		assert.ok(TRACKER_HEADER.includes("deadline"), "deadline column present");
		const result = planRecordApplication({
			company: "Acme",
			role: "Senior ML Engineer",
			fitScore: null,
			cvFile: "cv/main_acme_x.tex",
			coverLetterFile: "cover_letters/cover_acme_x.tex",
			trackerText: "",
			today: "2026-03-01",
		});
		assert.equal(result.ok, true);
		assert.ok(
			result.ok && result.trackerText.startsWith(TRACKER_HEADER),
			"generated tracker opens with the exact header",
		);
	});
});

describe("shipped client config", () => {
	it("points at the explicit job-hunter route", () => {
		const config = JSON.parse(readFileSync(join(ROOT, ".mcp.json"), "utf-8")) as {
			mcpServers: Record<string, { url: string }>;
		};
		assert.ok(
			config.mcpServers["job-hunter"].url.endsWith("/job-hunter/mcp"),
			"shipped config targets the explicit job-hunter route",
		);
	});
});
