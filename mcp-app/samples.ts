/**
 * Minimal sample calls per tool for the standalone preview. Each sample flows
 * through the same `mapToolToDashboard` mapper as live MCP results, so the
 * preview exercises the real rendering path with representative fields only.
 */

export interface SampleCall {
	args: unknown;
	structured: unknown;
	text: string;
}

export const SAMPLE_TOOLS = [
	"analyze-job",
	"tailor-resume",
	"generate-cover-letter",
	"track-application",
	"prepare-interview",
	"career-strategy",
	"draft-application-answers",
	"rank-jobs",
	"research-company",
	"research-job",
	"search-jobs",
	"setup-profile",
	"due-followups",
] as const;

export const SAMPLE_CALLS: Record<(typeof SAMPLE_TOOLS)[number], SampleCall> = {
	"analyze-job": {
		args: {
			company: "Acme Corp",
			role: "Backend Engineer",
			postingText: "Backend Engineer at Acme Corp (hybrid, Berlin). Build and own Python APIs serving usage-based billing. Requirements: 4+ years of backend delivery, PostgreSQL, incident ownership. Nice to have: Kubernetes.",
		},
		structured: {
			scored: true,
			eligibility: { verdict: "PASS", note: "Work authorization covers the posting country." },
			languageGate: { verdict: "PASS", note: "Posting language matches a declared language." },
			dimensions: [
				{ dimension: "Technical", score: 85, notes: "Python and API ownership match." },
				{ dimension: "Experience", score: 80, notes: "Four years of backend delivery." },
				{ dimension: "Behavioral", score: 75, notes: "Incident ownership is energizing." },
				{ dimension: "Career", score: 88, notes: "Direct step toward platform goals." },
			],
			overallScore: 82,
			verdict: "Strong Fit",
			strengths: ["Production Python ownership"],
			gaps: ["No Kubernetes exposure"],
			recommendation: "Proceed to drafting.",
			shouldCallEmployer: { suggest: false, reason: "Posting answers the open questions." },
			needsConfirmation: true,
			deadline: null,
		},
		text: "## Job Fit Evaluation: Backend Engineer at Acme Corp\n\n**Overall Score: 82/100**\n\n### Verdict: Strong Fit",
	},
	"tailor-resume": {
		args: { company: "Acme Corp", role: "Backend Engineer", postingText: "Build Python APIs." },
		structured: {
			slug: "acme-corp_backend-engineer",
			filePath: "cv/main_acme-corp_backend-engineer.html",
			pdfPath: "cv/main_acme-corp_backend-engineer.pdf",
			template: "modern-fixed-v1",
			pageLimit: 2,
			coverage: [
				{ requirement: "Python APIs", kind: "essential", status: "matched", evidence: "Shipped billing API" },
				{ requirement: "Kubernetes", kind: "nice-to-have", status: "gap" },
			],
			droppedBullets: [],
			warnings: {
				profileConsistency: [],
				draftDrift: [],
				stretchChoices: [{ bullet: "Led migration", reason: "Scope is larger than the evidence" }],
			},
			banViolations: [],
		},
		text: '{"slug": "acme-corp_backend-engineer", "filePath": "cv/main_acme-corp_backend-engineer.html", "pdfPath": "cv/main_acme-corp_backend-engineer.pdf", "template": "modern-fixed-v1", "pageLimit": 2}',
	},
	"generate-cover-letter": {
		args: { company: "Acme Corp", role: "Backend Engineer", postingText: "Build Python APIs." },
		structured: {
			slug: "acme-corp_backend-engineer",
			filePath: "cover_letters/cover_acme-corp_backend-engineer.html",
			pdfPath: "cover_letters/cover_acme-corp_backend-engineer.pdf",
			template: "letter-modern-fixed-v1",
			pageLimit: 1,
			wordCount: 278,
			coverage: [
				{ requirement: "Python APIs", kind: "essential", status: "matched", evidence: "Billing API" },
			],
			logistics: { workMode: "hybrid", deadline: null, referenceId: null },
			warnings: { profileConsistency: [], draftDrift: [], stretchChoices: [] },
			banViolations: [],
		},
		text: '{"slug": "acme-corp_backend-engineer", "filePath": "cover_letters/cover_acme-corp_backend-engineer.html", "pdfPath": "cover_letters/cover_acme-corp_backend-engineer.pdf", "template": "letter-modern-fixed-v1", "pageLimit": 1, "wordCount": 278}',
	},
	"track-application": {
		args: { company: "Acme Corp", role: "Backend Engineer" },
		structured: {
			action: "append",
			row: "2026-10-01,Acme Corp,,Backend Engineer,,,,applied,,,,,,",
			rowIndex: null,
			trackerHash: "abc123def456",
			archiveFile: "documents/applications/acme-corp_backend-engineer/posting.md",
			archiveNote: null,
			openMatchCount: 1,
		},
		text: '{"action": "append", "trackerHash": "abc123def456", "archiveFile": "documents/applications/acme-corp_backend-engineer/posting.md"}',
	},
	"prepare-interview": {
		args: { company: "Acme Corp", role: "Backend Engineer" },
		structured: {
			company: "Acme Corp",
			role: "Backend Engineer",
			stage: "recruiter-screen",
			packFile: "documents/applications/acme-corp_backend-engineer/prep_recruiter-screen.md",
			packMarkdown: "## Interview pack: recruiter-screen\n\n### Likely questions\n- Tell me about a production incident you owned",
			missingLogistics: ["interview date"],
			fallbackNotes: [],
			questions: [
				{
					question: "Tell me about a production incident you owned",
					source: "fit-gap",
					bridge: "Use the billing outage example.",
				},
			],
			starMapping: [{ title: "Billing outage", useFor: ["ownership"], covers: ["Tell me about a production incident you owned"] }],
			uncoveredQuestions: [],
			newStarDrafts: [],
			probeableClaims: [],
			toughQuestions: ["Why Acme now?"],
			questionsToAsk: ["How is on-call scoped for this team?"],
			warnings: [],
		},
		text: '{"stage": "recruiter-screen", "packFile": "documents/applications/acme-corp_backend-engineer/prep_recruiter-screen.md", "missingLogistics": ["interview date"]}',
	},
	"career-strategy": {
		args: {},
		structured: {
			directions: [
				{
					direction: "Backend engineering",
					why: ["Four years of API ownership"],
					evidence: ["Billing API delivery"],
					gapsToClose: ["Kubernetes exposure"],
					dimensions: ["Technical", "Experience"],
				},
			],
			skipped: [],
			priorityGaps: ["Kubernetes exposure"],
			avoidNotes: [],
			frameworkNote: "Grounded in profile evidence.",
			warnings: [],
		},
		text: '{\n  "directions": [\n    {\n      "direction": "Backend engineering",\n      "why": ["Four years of API ownership"]\n    }\n  ]\n}',
	},
	"draft-application-answers": {
		args: { company: "Acme Corp" },
		structured: {
			filePath: "documents/portal_answers.txt",
			copyPasteText: "Self-introduction (technical, 120 words): ...",
			selfIntros: [{ roleType: "technical", text: "...", wordCount: 120, targetWords: 150, trimNote: null }],
			projectEntries: [],
			pitches: [{ text: "...", charCount: 140, context: "LinkedIn", recommended: true }],
			datesReference: [],
			scopeNotes: [],
			ungrounded: [],
			warnings: [],
		},
		text: '{"filePath": "documents/portal_answers.txt", "selfIntros": [], "pitches": [], "ungrounded": []}',
	},
	"rank-jobs": {
		args: {},
		structured: {
			eligibleCount: 2,
			deferredCount: 0,
			trackerExcludedCount: 0,
			focusSkippedCount: 0,
			nextCursor: null,
			profileHash: "abc123",
			ranked: [],
			shortlist: [
				{
					key: "acme-backend",
					title: "Backend Engineer",
					company: "Acme Corp",
					url: "https://example.com/jobs/1",
					portal: "site",
					score: 82,
					verdict: "Strong Fit",
					locationVerdict: "PASS",
					languageGate: "PASS",
					deadline: null,
					flags: [],
				},
			],
			belowThreshold: [],
			excluded: [],
			closingSoon: [],
			sweptExpired: [],
			sweptClosingSoon: [],
			stateUpdates: [],
			limits: { limit: 10, top: 5 },
			notes: [],
			errors: [],
		},
		text: '{"eligibleCount": 2, "shortlist": [{"key": "acme-backend", "score": 82, "verdict": "Strong Fit"}]}',
	},
	"research-company": {
		args: { company: "Acme Corp" },
		structured: {
			company: "Acme Corp",
			cached: true,
			cacheFile: "company_research/acme-corp.json",
			claims: [
				{
					text: "Acme runs a usage-based billing platform.",
					fetched: true,
					sourceUrl: "https://acme.example/about",
					sourcedFrom: "company-domain",
				},
			],
			sourcing: { sourcedCount: 1, droppedCount: 0, sources: ["https://acme.example/about"], notes: [] },
			fetchSteps: ["cache-hit"],
			trustNote: "Sourced means the sentence appeared on a fetched page, never that it is true.",
		},
		text: '{"company": "Acme Corp", "cached": true, "cacheFile": "company_research/acme-corp.json"}',
	},
	"research-job": {
		args: { company: "Acme Corp", role: "Backend Engineer" },
		structured: {
			company: "Acme Corp",
			role: "Backend Engineer",
			briefMode: false,
			snapshot: [
				{
					topic: "salary",
					claim: "Levels-fyi band €90-110k for Berlin backend roles.",
					sourceLabel: "Sourced via host search",
					sourceUrl: "https://example.com/salary",
				},
				{
					topic: "culture",
					claim: "Reviews praise on-call compensation.",
					sourceLabel: "Unsourced host note (lead only, never cite)",
				},
			],
			fitNotes: ["Python appears in the findings and matches your core strengths"],
			redFlags: [],
			questionsToAsk: ["What are the interview stages and the hiring timeline?"],
			suggestedQueries: ['"Acme Corp" "Backend Engineer" salary band'],
			sourcing: { sourcedCount: 1, unsourcedCount: 1, sources: ["https://example.com/salary"], droppedEmpty: 0 },
			warnings: [],
		},
		text: '{"company": "Acme Corp", "role": "Backend Engineer", "briefMode": false, "snapshot": [{"topic": "salary"}]}',
	},
	"search-jobs": {
		args: { keywords: "backend", location: "Berlin" },
		structured: {
			filters: { keywords: "backend", location: "Berlin", limit: 10 },
			jobs: [
				{
					id: "remotive:https://remotive.com/remote-jobs/software-development/backend-engineer-1",
					title: "Backend Engineer",
					company: "Acme Corp",
					url: "https://remotive.com/remote-jobs/software-development/backend-engineer-1",
					location: "Berlin",
					postedAt: "2026-09-28",
					remote: true,
				},
			],
			nextCursor: null,
			notes: [],
			errors: [],
		},
		text: '{"filters": {"keywords": "backend", "location": "Berlin"}, "jobs": [{"id": "remotive:https://remotive.com/remote-jobs/software-development/backend-engineer-1", "title": "Backend Engineer"}]}',
	},
	"setup-profile": {
		args: { resumeText: "Ada Example, Berlin. Python engineer." },
		structured: {
			profile: {
				name: "Ada Example",
				location: "Berlin",
				skills: [
					{ name: "Python", category: "primary" },
					{ name: "APIs", category: "primary" },
				],
				domains: [{ name: "backend", category: "strong" }],
				preferences: { targetRoles: ["platform engineering"] },
			},
			resumeHash: "def456",
			notes: ["Derived from the uploaded resume."],
			warnings: [],
			dbNote: "Host owns persistence.",
		},
		text: '{"profile": {"name": "Ada Example"}, "resumeHash": "def456", "dbNote": "Host owns persistence."}',
	},
	"due-followups": {
		args: {},
		structured: {
			due: [
				{
					jobKey: "acme-backend",
					company: "Acme Corp",
					role: "Backend Engineer",
					status: "applied",
					daysStale: 9,
					reason: "untouched for 9 days",
					suggestedAction: "Send a short check-in.",
				},
			],
			checked: 4,
			staleDays: 7,
			deadlineWithinDays: 3,
			note: "Open rows untouched past the threshold or with a near deadline.",
		},
		text: '{"due": [{"jobKey": "acme-backend", "suggestedAction": "Send a short check-in."}], "checked": 4}',
	},
};
