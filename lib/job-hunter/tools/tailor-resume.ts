import type { McpServer } from "@modelcontextprotocol/server";

import { jobHunterAppMeta } from "@/lib/job-hunter/ui.ts";

import { prisma } from "@/lib/db.ts";
import { sectionHeadings } from "@/lib/job-hunter/document.ts";
import type { FetchLike } from "@/lib/job-hunter/fetch-posting.ts";
import { fetchPageDetail } from "@/host/job-hunter/scraper/detail.ts";
import { loadActiveProfile, userIdFromRequest } from "@/lib/job-hunter/request-profile.ts";
import {
	buildResumeVerification,
	buildTailorEventNote,
	logTailorEvent,
	saveResumeVersion,
	tailorInputHash,
} from "@/lib/job-hunter/resume-version.ts";
import { buildTailoredCv } from "@/lib/job-hunter/tailor.ts";
import { countPdfPages, renderHtmlToPdf } from "@/lib/job-hunter/render-tailored-cv.ts";
import { documentSignals } from "@/lib/job-hunter/verify.ts";
import { TailorCvInput, TailorCvOutput } from "@/lib/job-hunter/schemas/tailor-resume.ts";

/** Test seam (repo convention): production leaves fetchImpl unset and uses the default fetch. */
export function registerTailorResume(server: McpServer, options: { fetchImpl?: FetchLike } = {}): void {
	server.registerTool(
		"tailor-resume",
		{
			title: "Tailor resume",
			description:
				"Tailors a resume to one posting: Groq fills the structured CV shape, rendered on the predefined modern HTML template. Returns HTML and a Puppeteer-rendered A4 PDF. EMPTY_SLUG is a hard error with no document output; a missing GROQ_API_KEY is an honest error, never a silent fallback.",
			inputSchema: TailorCvInput,
			outputSchema: TailorCvOutput,
			...jobHunterAppMeta(),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async (input, extra) => {
			const started = Date.now();
			const profile = await loadActiveProfile(extra);
			let postingText = input.postingText;
			let postingUrl = input.postingUrl ?? input.jobUrl;
			if (!postingText) {
				if (!input.jobUrl) {
					return {
						isError: true,
						content: [{ type: "text" as const, text: "Provide postingText or jobUrl." }],
					};
				}
				try {
					const detail = await fetchPageDetail(input.jobUrl);
					postingText = detail.description;
					postingUrl = postingUrl ?? detail.url;
				} catch (error) {
					return {
						isError: true,
						content: [
							{
								type: "text" as const,
								text: `Job detail unavailable (${error instanceof Error ? error.message : String(error)}); nothing invented.`,
							},
						],
					};
				}
				if (!postingText || postingText.trim().length === 0) {
					return {
						isError: true,
						content: [{ type: "text" as const, text: "Job detail empty; nothing invented." }],
					};
				}
			}
			const result = await buildTailoredCv(
				{
					...input,
					postingText,
					...(postingUrl !== undefined ? { postingUrl } : {}),
					profile,
				},
				{
					apiKey: process.env["GROQ_API_KEY"] || undefined,
					model: input.llm?.model ?? process.env["LLM_MODEL"] ?? undefined,
					fetchImpl: options.fetchImpl,
				},
			);
			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text" as const, text: result.error }],
				};
			}
			const pdf = await renderHtmlToPdf(result.html);
			const renderedPageCount = await countPdfPages(pdf);
			if (renderedPageCount > result.pageLimit) {
				result.warnings.pageCountNote = `Rendered document uses ${renderedPageCount} pages; target is ${result.pageLimit} pages.`;
			}
			const { ok: _cvOk, ...cvStructured } = result;
			const signals = documentSignals("cv-html", result.html);
			const verification = buildResumeVerification({
				coverage: result.coverage,
				draftDrift: result.warnings.draftDrift,
				renderSafetyPassed: signals.renderSafety.passed,
			});
			const payload: Record<string, unknown> = {
				...cvStructured,
				pdfPath: `cv/main_${result.slug}.pdf`,
				pdfBase64: Buffer.from(pdf).toString("base64"),
				signals,
				verification,
			};
			// Best-effort observability (ticket 03): store the version and
			// leave a redacted EventLog entry. Anonymous callers and
			// database-less hosts skip silently; observability never fails
			// a tailoring call.
			try {
				const userId = userIdFromRequest(extra);
				const client = prisma;
				if (userId && client) {
					const stored = await saveResumeVersion(client, {
						userId,
						jobKey: result.slug,
						html: result.html,
						verification,
					})
					if (stored.persisted && stored.id !== undefined) {
						payload["versionId"] = stored.id;
					}
					await logTailorEvent(client, {
						userId,
						ok: true,
						ms: Date.now() - started,
						note: buildTailorEventNote({
							slug: result.slug,
							verification,
							driftCount: result.warnings.draftDrift.length,
							stretchCount: result.warnings.stretchChoices.length,
							stored: stored.persisted,
						}),
						inputHash: tailorInputHash(postingText),
						outputRef: stored.id !== undefined ? `resume-version:${stored.id}` : result.slug,
					});
				}
			} catch {
				// Observability is best-effort; the tailored draft still returns.
			}
			return {
				content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
				structuredContent: payload,
			};
		},
	);
}
