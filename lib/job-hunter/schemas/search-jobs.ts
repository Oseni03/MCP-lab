import { z } from "zod";

/** Thin Remotive-only input/output contract (locked spec Q8+Q11). */

export const SearchJobsInput = z
	.object({
		keywords: z.string().optional().describe("Keyword query for the Remotive API (?search=)"),
		location: z.string().optional().describe("Client-side filter on candidate_required_location"),
		limit: z.number().int().positive().optional().describe("Page size; defaults 10, capped at 20 server-side"),
		cursor: z
			.string()
			.optional()
			.describe("Opaque resume token from a previous page; the server holds no state"),
	})
	.strict();

export const ThinJobSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		company: z.string(),
		url: z.string().url(),
		location: z.string().nullable(),
		postedAt: z.string().nullable(),
		remote: z.boolean(),
	})
	.strict();

export const SearchJobsOutput = z
	.object({
		filters: z
			.object({
				keywords: z.string(),
				location: z.string(),
				limit: z.number(),
			})
			.strict(),
		jobs: z.array(ThinJobSchema),
		nextCursor: z.string().nullable(),
		notes: z.array(z.string()),
		errors: z.array(z.string()),
	})
	.strict();
