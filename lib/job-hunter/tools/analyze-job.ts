import type { McpServer } from "@modelcontextprotocol/server";

import { jobHunterAppMeta } from "@/lib/job-hunter/ui.ts";

import { evaluateJob } from "@/lib/job-hunter/evaluate.ts";
import { buildRefinePrompt, groqRefine, mergeRefinement } from "@/lib/job-hunter/llm.ts";
import type { FetchLike } from "@/lib/job-hunter/fetch-posting.ts";
import { loadActiveProfile } from "@/lib/job-hunter/request-profile.ts";
import { EvaluateJobInput, EvaluationSchema } from "@/lib/job-hunter/schemas/analyze-job.ts";
import { fetchPageDetail } from "@/host/job-hunter/scraper/detail.ts";

/**
 * Thin Remotive-only analyze-job (locked spec Q6=a, Q9, Q12):
 * resolves detail by reusing the search-hit description when pasted, else
 * re-fetching the job URL once, then Groq-only fit refinement against the
 * stored profile. No sampling, no heuristic fallback, no company research.
 * A missing GROQ_API_KEY is an honest error, never a silent fallback.
 */
export function registerAnalyzeJob(
	server: McpServer,
	options: { fetchImpl?: FetchLike } = {},
): void {
	server.registerTool(
		"analyze-job",
		{
			title: "Analyze job",
			description:
				"Remotive detail + Groq fit: resolves one search-job URL to its full description (reused pasted text or single re-fetch), then Groq-refines score, verdict, strengths, gaps, and recommendation against the stored profile. Groq-only; missing GROQ_API_KEY errors honestly.",
			inputSchema: EvaluateJobInput,
			outputSchema: EvaluationSchema,
			...jobHunterAppMeta(),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async (input, extra) => {
			if (!input.jobUrl && !input.postingText) {
				return {
					isError: true,
					content: [{ type: "text" as const, text: "Provide jobUrl (preferred) or postingText." }],
				};
			}
			const profile = await loadActiveProfile(extra);

			let title = "Pasted posting";
			let company = "Unknown company";
			let url = input.jobUrl ?? "pasted-text";
			let location: string | null = null;
			let postedAt: string | null = null;
			let postingText = input.postingText;
			let fetchSteps = ["pasted-text"];
			if (!postingText) {
				const target = input.jobUrl as string;
				try {
					const detail = await fetchPageDetail(target);
					title = detail.title;
					company = detail.company;
					url = detail.url;
					location = detail.location ?? null;
					postedAt = detail.postedAt ? detail.postedAt.toISOString().slice(0, 10) : null;
					postingText = detail.description;
					fetchSteps = ["remotive-refetch"];
				} catch (error) {
					return {
						isError: true,
						content: [
							{
								type: "text" as const,
								text: `Posting genuinely unavailable: remotive-refetch failed (${error instanceof Error ? error.message : String(error)}). Transient failure, never invented content.`,
							},
						],
					};
				}
				if (!postingText || postingText.trim().length === 0) {
					return {
						isError: true,
						content: [{ type: "text" as const, text: "Posting genuinely unavailable: empty detail. Nothing invented." }],
					};
				}
			}

			const apiKey = process.env.GROQ_API_KEY || undefined;
			if (!apiKey) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: "GROQ_API_KEY not configured; analyze-job is Groq-only and refuses to fall back silently. Set GROQ_API_KEY to refine.",
						},
					],
				};
			}

			const heuristic = evaluateJob({ postingText, profile, source: url });
			const model = input.llm?.model ?? process.env.LLM_MODEL ?? undefined;
			let refined: unknown;
			try {
				refined = await groqRefine(buildRefinePrompt(postingText, profile, heuristic), {
					apiKey,
					...(model !== undefined ? { model } : {}),
					...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
				});
			} catch (error) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: `Groq refinement failed (${error instanceof Error ? error.message : String(error)}); nothing invented.`,
						},
					],
				};
			}
			const evaluation = mergeRefinement(heuristic, postingText, profile, refined);

			const payload = {
				detail: {
					id: `remotive:${url}`,
					title,
					company,
					url,
					location,
					postedAt,
					description: postingText,
				},
				fit: {
					score: evaluation.overallScore,
					verdict: evaluation.verdict,
					strengths: evaluation.strengths,
					gaps: evaluation.gaps,
					recommendation: evaluation.recommendation,
				},
				refinement: {
					source: "groq" as const,
					model: model ?? null,
					note: "Refined via Groq over the heuristic scaffold.",
				},
				fetchSteps,
				needsConfirmation: true as const,
			};
			return {
				content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
				structuredContent: payload,
			};
		},
	);
}
