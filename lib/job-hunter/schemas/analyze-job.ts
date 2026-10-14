import { z } from "zod";

/** Thin Remotive-only input/output contract for analyze-job (locked spec Q9+Q12). */

export const EvaluateJobInput = z
	.object({
		jobUrl: z.string().url().optional().describe("Remotive job URL from search-jobs (preferred input)"),
		postingText: z
			.string()
			.min(1)
			.optional()
			.describe("Full posting text fallback (tests and pasted flows only)"),
		llm: z
			.object({
				model: z.string().min(1).optional().describe("Groq model override"),
			})
			.strict()
			.optional()
			.describe("Groq-only refinement; a missing GROQ_API_KEY is an honest error"),
	})
	.strict();

export const EvaluationSchema = z
	.object({
		detail: z
			.object({
				id: z.string(),
				title: z.string(),
				company: z.string(),
				url: z.string(),
				location: z.string().nullable(),
				postedAt: z.string().nullable(),
				description: z.string(),
			})
			.strict(),
		fit: z
			.object({
				score: z.number().nullable(),
				verdict: z.string().nullable(),
				strengths: z.array(z.string()),
				gaps: z.array(z.string()),
				recommendation: z.string(),
			})
			.strict(),
		refinement: z
			.object({
				source: z.enum(["groq"]),
				model: z.string().nullable(),
				note: z.string(),
			})
			.strict(),
		fetchSteps: z.array(z.string()),
		needsConfirmation: z.literal(true),
	})
	.strict();
