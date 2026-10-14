import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	getCompanyResearchResource,
	getCvVariant,
	getPrompt,
	getResource,
	listCvVariants,
	listPrompts,
	listResources,
	resolveBaseContent,
} from "@/lib/job-hunter/resources.ts";

describe("listResources", () => {
	it("exposes the six versioned materials with stable URIs", () => {
		const resources = listResources();
		const uris = resources.map((resource) => resource.uri);
		for (const uri of [
			"job-hunter://profile/candidate",
			"job-hunter://profile/behavioral",
			"job-hunter://rules/writing",
			"job-hunter://framework/evaluation",
			"job-hunter://templates/cv",
			"job-hunter://templates/cover-letter",
		]) {
			assert.ok(uris.includes(uri), `missing resource ${uri}`);
		}
		for (const resource of resources) {
			assert.ok(resource.version >= 1, `${resource.uri} carries a version`);
			assert.ok(resource.name.length >= 2, `${resource.uri} has a name`);
		}
	});
});

describe("getResource", () => {
	it("returns the private server default with its version", () => {
		const result = getResource("job-hunter://framework/evaluation");
		assert.equal(result.ok, true);
		assert.ok(result.ok && result.text.includes("Technical"), "framework default names dimensions");
		assert.ok(result.ok && result.version >= 1, "version marked on every resource");
	});

	it("lets a per-call override win everywhere", () => {
		const result = getResource("job-hunter://rules/writing", "Custom house style: Oxford commas.");
		assert.equal(result.ok, true);
		assert.ok(result.ok && result.overridden, "override flagged");
		assert.equal(result.ok && result.text, "Custom house style: Oxford commas.");
	});

	it("degrades to an explicit message for unknown URIs, never a guess", () => {
		const result = getResource("job-hunter://nope/missing");
		assert.equal(result.ok, false);
		assert.ok(!result.ok && result.error.includes("job-hunter://nope/missing"), "names the missing entry");
	});
});

describe("CV variants", () => {
	it("lists base variants for fetch", () => {
		const variants = listCvVariants();
		assert.ok(variants.length > 0, "at least one base variant");
		for (const variant of variants) {
			assert.ok(variant.name.length >= 2 && variant.description.length >= 2, "listable with description");
		}
	});

	it("fetches a variant by name", () => {
		const first = listCvVariants()[0].name;
		const result = getCvVariant(first);
		assert.equal(result.ok, true);
		assert.ok(result.ok && result.text.length > 0, "variant carries content");
	});

	it("passes caller-supplied base content straight through", () => {
		const result = resolveBaseContent("modern-fixed-v1", "<html><!-- caller master --></html>");
		assert.equal(result.ok, true);
		assert.ok(result.ok && result.text.includes("caller master"), "caller content wins over server disk");
		assert.ok(result.ok && result.fromCaller, "passthrough flagged");
	});

	it("falls back to the server variant when the caller supplies nothing", () => {
		const first = listCvVariants()[0].name;
		const result = resolveBaseContent(first);
		assert.equal(result.ok, true);
		assert.ok(result.ok && !result.fromCaller, "server fallback flagged");
	});

	it("errors explicitly for unknown variants", () => {
		const result = getCvVariant("no-such-variant");
		assert.equal(result.ok, false);
		assert.ok(!result.ok && result.error.includes("no-such-variant"), "names the missing variant");
	});
});

describe("prompts", () => {
	it("lists the workflow prompts with versions", () => {
		const prompts = listPrompts();
		const names = prompts.map((prompt) => prompt.name);
		for (const name of ["apply", "rank", "interview", "scrape-health", "tailor-flow"]) {
			assert.ok(names.includes(name), `missing prompt ${name}`);
		}
		for (const prompt of prompts) {
			assert.ok(prompt.version >= 1, `${prompt.name} carries a version`);
		}
	});

	it("lets a per-call override win for prompts too", () => {
		const result = getPrompt("apply", "Custom checklist.");
		assert.equal(result.ok, true);
		assert.ok(result.ok && result.overridden, "override flagged");
		assert.equal(result.ok && result.text, "Custom checklist.");
	});

	it("errors explicitly for unknown prompts", () => {
		const result = getPrompt("no-such-prompt");
		assert.equal(result.ok, false);
	});
});

describe("full resource catalog (ticket 10)", () => {
	it("exposes profiles, rules, framework, CV master, cover example, and search strategy as versioned resources", () => {
		const uris = listResources().map((resource) => resource.uri);
		for (const uri of [
			"job-hunter://profile/candidate",
			"job-hunter://profile/behavioral",
			"job-hunter://rules/writing",
			"job-hunter://framework/evaluation",
			"job-hunter://reference/cv-master",
			"job-hunter://reference/cover-example",
			"job-hunter://strategy/search-queries",
		]) {
			assert.ok(uris.includes(uri), `missing resource ${uri}`);
		}
		for (const resource of listResources()) {
			assert.ok(resource.version >= 1, `${resource.uri} marks its version`);
		}
		const framework = getResource("job-hunter://framework/evaluation");
		assert.ok(framework.ok && framework.text.includes("Technical"), "framework default names dimensions");
	});

	it("exposes variant listing and state pointers as identifiers and counts only", () => {
		const uris = listResources().map((resource) => resource.uri);
		for (const uri of [
			"job-hunter://templates/cv-variants",
			"job-hunter://state/seen-keys",
			"job-hunter://state/tracker",
			"job-hunter://research/companies",
		]) {
			assert.ok(uris.includes(uri), `missing resource ${uri}`);
		}
		const seen = getResource("job-hunter://state/seen-keys");
		assert.ok(seen.ok && !seen.text.includes("Acme Corp specific posting"), "pointer carries no backlog contents");
		const tracker = getResource("job-hunter://state/tracker");
		assert.ok(tracker.ok && tracker.text.includes("tracker"), "tracker pointer names the store");
	});

	it("reads per-company research with caller fallback so generation never depends on server disk", () => {
		const callerText = JSON.stringify({
			company: "Acme Corp",
			fetched_date: new Date().toISOString().slice(0, 10),
			sources: { website: { url: "https://acme.com", notes: "caller-held discovery" } },
		});
		const fromCaller = getCompanyResearchResource("acme-corp", { callerContent: callerText });
		assert.equal(fromCaller.ok, true);
		assert.ok(fromCaller.ok && fromCaller.fromCaller, "caller content wins");
		assert.ok(fromCaller.ok && fromCaller.text.includes("caller-held"), "caller payload served");

		const missing = getCompanyResearchResource("no-such-co", { cacheDir: mkdtempSync(join(tmpdir(), "res-missing-")) });
		assert.equal(missing.ok, false);
		assert.ok(!missing.ok && missing.error.includes("no-such-co"), "missing entry names the slug");
	});

	it("degrades stale research to an explicit message rather than a guess", () => {
		const dir = mkdtempSync(join(tmpdir(), "res-stale-"));
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		writeFileSync(
			join(dir, "acme-corp.json"),
			JSON.stringify({ company: "Acme Corp", fetched_date: old, sources: {} }),
		);
		const stale = getCompanyResearchResource("acme-corp", { cacheDir: dir, now: new Date() });
		assert.equal(stale.ok, false);
		assert.ok(!stale.ok && stale.error.includes("stale"), "stale entry reported explicitly");
	});
});

describe("workflow prompts (ticket 11)", () => {
	it("provides a full apply checklist without hardcoding the manual workflow", () => {
		const apply = getPrompt("apply");
		assert.equal(apply.ok, true);
		assert.ok(apply.ok && apply.version >= 2, "full checklist versioned");
		for (const step of [
			"escalation",
			"gate",
			"ask",
			"coverage",
			"grounding audit",
			"Part A",
			"Part B",
			"render",
			"text-layer",
			"keyword",
			"verification",
			"record",
			"form fields",
		]) {
			assert.ok(apply.ok && apply.text.toLowerCase().includes(step.toLowerCase()), `apply mentions ${step}`);
		}
	});

	it("provides a full rank checklist from focus to shortlist", () => {
		const rank = getPrompt("rank");
		assert.equal(rank.ok, true);
		for (const step of [
			"focus",
			"limit",
			"state",
			"fetch-or-expired",
			"weights",
			"veto",
			"urgency",
			"sweep",
			"staleness",
			"shortlist",
			"analyze-job",
		]) {
			assert.ok(rank.ok && rank.text.toLowerCase().includes(step.toLowerCase()), `rank mentions ${step}`);
		}
	});

	it("provides a full interview checklist from archive to mock", () => {
		const interview = getPrompt("interview");
		assert.equal(interview.ok, true);
		for (const step of [
			"tracked",
			"archive",
			"sibling",
			"cache-first",
			"interviewer",
			"STAR",
			"consistency",
			"tough",
			"questions to ask",
			"logistics",
			"mock",
			"roleplay",
			"outcome",
		]) {
			assert.ok(
				interview.ok && interview.text.toLowerCase().includes(step.toLowerCase()),
				`interview mentions ${step}`,
			);
		}
	});

	it("provides a bounded scrape-health checklist with observed-output verdicts only", () => {
		const health = getPrompt("scrape-health");
		assert.equal(health.ok, true);
		for (const step of [
			"free-pass",
			"sentinel",
			"retry",
			"degraded",
			"broken",
			"rate-limited",
			"observed",
			"confirmation",
		]) {
			assert.ok(health.ok && health.text.toLowerCase().includes(step.toLowerCase()), `scrape-health mentions ${step}`);
		}
	});

	it("provides a tailor-flow checklist with page budgets and cutting order", () => {
		const flow = getPrompt("tailor-flow");
		assert.equal(flow.ok, true);
		for (const step of [
			"override",
			"structural reference",
			"section",
			"page budget",
			"cutting order",
			"compile",
			"verify",
		]) {
			assert.ok(flow.ok && flow.text.toLowerCase().includes(step.toLowerCase()), `tailor-flow mentions ${step}`);
		}
	});
});
