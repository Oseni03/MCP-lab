import type { McpServer } from "@modelcontextprotocol/server";

import { jobHunterAppMeta } from "@/lib/job-hunter/ui.ts";

import { loadActiveProfile } from "@/lib/job-hunter/request-profile.ts";
import { buildCoverLetter } from "@/lib/job-hunter/tailor.ts";
import { fetchPageDetail } from "@/host/job-hunter/scraper/detail.ts";
import { countPdfPages, renderHtmlToPdf } from "@/lib/job-hunter/render-tailored-cover-letter.ts";
import { documentSignals } from "@/lib/job-hunter/verify.ts";
import { CoverInput, CoverOutput } from "@/lib/job-hunter/schemas/generate-cover-letter.ts";

export function registerGenerateCoverLetter(server: McpServer): void {
	server.registerTool(
		"generate-cover-letter",
		{
			title: "Generate cover letter",
			description:
				"Drafts a cover letter for one posting using the predefined HTML template. Returns HTML and a Puppeteer-rendered A4 PDF. EMPTY_SLUG is a hard error with no document output.",
			inputSchema: CoverInput,
			outputSchema: CoverOutput,
			...jobHunterAppMeta(),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async (input, extra) => {
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
			const result = buildCoverLetter({
				...input,
				postingText,
				...(postingUrl !== undefined ? { postingUrl } : {}),
				profile,
			});
			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text" as const, text: result.error }],
				};
			}
			const pdf = await renderHtmlToPdf(result.html);
			const renderedPageCount = await countPdfPages(pdf);
			const { ok: _coverOk, ...coverStructured } = result;
			const signals = documentSignals("letter-html", result.html);
			const payload = {
				...coverStructured,
				pdfPath: `cover_letters/cover_${result.slug}.pdf`,
				pdfBase64: Buffer.from(pdf).toString("base64"),
				signals,
				warnings: renderedPageCount > result.pageLimit
					? { ...result.warnings, pageCountNote: `Rendered document uses ${renderedPageCount} pages; target is ${result.pageLimit} pages.` }
					: result.warnings,
			};
			return {
				content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
				structuredContent: payload,
			};
		},
	);
}
