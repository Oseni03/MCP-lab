import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const origin =
    process.argv.slice(2).find((argument) => argument !== "--") ||
    "http://localhost:3000";

async function main() {
    const client = new Client({
        name: "job-hunter-test-client",
        version: "1.0.0",
    });
    const endpoint = new URL("/job-hunter/mcp", `${origin}/`);
    const transport = new StreamableHTTPClientTransport(endpoint);

    console.log("Connecting to", endpoint.toString());
    await client.connect(transport);

    console.log("Connected", client.getServerCapabilities());

    const { tools } = await client.listTools();
    console.log("Tools", tools.map((tool) => tool.name));

    const postingText = [
        "Senior ML Engineer at Acme.",
        "We welcome international applicants and offer visa sponsorship.",
        "Requirements: Python, SQL, Machine Learning.",
        "Nice to have: Docker, Kubernetes.",
        "Domain: fraud detection.",
        "Remote. Apply by 15 March 2026. Ref: ACME-123.",
    ].join("\n");
    const profile = {
        name: "Test Candidate",
        primarySkills: ["Python", "SQL", "Machine Learning"],
        secondarySkills: ["Docker"],
        strongDomains: ["fraud detection"],
        adjacentDomains: ["credit risk"],
        careerGoals: ["ML Engineer"],
        energizingTasks: ["model building"],
        drainingTasks: ["maintenance"],
        languages: [{ language: "English", level: "C1" }],
    };

    const result = await client.callTool({
        name: "analyze-job",
        arguments: { postingText, company: "Acme", role: "Senior ML Engineer", profile },
    });
    console.log("Result", JSON.stringify(result, null, 2));

    const cv = await client.callTool({
        name: "tailor-resume",
        arguments: {
            postingText,
            company: "Acme",
            role: "Senior ML Engineer",
            profile,
            experience: [
                {
                    title: "Data Analyst",
                    company: "R&D Corp",
                    period: "2020-2024",
                    bullets: ["Cut losses by 12% with Python models for fraud detection."],
                },
            ],
            education: [
                {
                    degree: "MSc Data Science",
                    period: "2022-2024",
                    institution: "Test University",
                    inProgress: true,
                    expectedDate: "June 2026",
                },
            ],
        },
    });
    console.log("CV", JSON.stringify(cv, null, 2));

    const letter = await client.callTool({
        name: "generate-cover-letter",
        arguments: {
            postingText,
            company: "Acme",
            role: "Senior ML Engineer",
            profile,
            hiringManager: "Jane Smith",
            companySpecifics: ["Acme processes payments across Europe."],
            highlights: ["Shipped a model that cut review time by 30%."],
        },
    });
    console.log("Letter", JSON.stringify(letter, null, 2));

    const emptySlug = await client.callTool({
        name: "tailor-resume",
        arguments: { postingText: "Requirements: Python.", profile },
    });
    console.log("EmptySlug", JSON.stringify(emptySlug, null, 2));

    const recordArgs = {
        company: "Acme",
        role: "Senior ML Engineer",
        fitScore: 84,
        cvFile: "cv/main_acme_senior-ml-engineer.tex",
        coverLetterFile: "cover_letters/cover_acme_senior-ml-engineer.tex",
        postingUrl: "https://example.com/jobs/1",
        deadline: "2026-04-01",
        postingText,
        trackerText: "",
        today: "2026-03-01",
    };
    const recordAppend = await client.callTool({ name: "track-application", arguments: recordArgs });
    console.log("RecordAppend", JSON.stringify(recordAppend, null, 2));

    const appendedTracker = recordAppend.structuredContent?.trackerText ?? "";
    const recordUpdate = await client.callTool({
        name: "track-application",
        arguments: { ...recordArgs, trackerText: appendedTracker, deadline: undefined },
    });
    console.log("RecordUpdate", JSON.stringify(recordUpdate, null, 2));

    const prep = await client.callTool({
        name: "prepare-interview",
        arguments: {
            company: "Acme",
            role: "Senior ML Engineer",
            stage: "technical",
            postingText,
            stageHistoryText: "Feedback: concern about Kubernetes depth.",
            profile,
            logistics: { format: "video" },
        },
    });
    console.log("Prep", JSON.stringify(prep, null, 2));

    const strategy = await client.callTool({
        name: "career-strategy",
        arguments: {
            profile,
            focusAreas: ["Astronaut", "credit risk"],
            evaluationSummary: { fitScore: 84, verdict: "Good Fit", gaps: ["Kubernetes"] },
        },
    });
    console.log("Strategy", JSON.stringify(strategy, null, 2));

    const fields = await client.callTool({
        name: "draft-application-answers",
        arguments: {
            profile,
            company: "Acme",
            employerPoints: ["Acme processes payments across Europe."],
            projects: [
                {
                    name: "Fraud scoring pipeline",
                    role: "ML Engineer",
                    dates: "2024-present",
                    description: "Built a Python scoring pipeline for fraud detection with SQL features.",
                },
            ],
            targetWords: 200,
        },
    });
    console.log("Fields", JSON.stringify(fields, null, 2));

    const search = await client.callTool({
        name: "search-jobs",
        arguments: {
            keywords: "Python ML Engineer",
            location: "Berlin, Germany",
            limit: 10,
        },
    });
    console.log("Search", JSON.stringify(search, null, 2));

    const rank = await client.callTool({
        name: "rank-jobs",
        arguments: {
            items: [
                {
                    key: "acme_ml-engineer",
                    title: "ML Engineer",
                    company: "Acme",
                    url: "https://example.com/jobs/1",
                    postingText: postingText,
                },
            ],
            profile,
        },
    });
    console.log("Rank", JSON.stringify(rank, null, 2));

    const research = await client.callTool({
        name: "research-company",
        arguments: {
            company: "Acme",
            companyUrl: "https://example.com",
            cacheText: JSON.stringify({
                company: "Acme",
                fetched_date: new Date().toISOString().slice(0, 10),
                sources: { website: { url: "https://example.com", notes: "cached discovery" } },
            }),
        },
    });
    console.log("Research", JSON.stringify(research, null, 2));

    const { resources } = await client.listResources();
    console.log("Resources", resources.map((resource) => resource.uri));
    const framework = await client.readResource({ uri: "job-hunter://framework/evaluation" });
    console.log("Framework", JSON.stringify(framework, null, 2).slice(0, 400));
    const searchStrategy = await client.readResource({ uri: "job-hunter://strategy/search-queries" });
    console.log("SearchStrategy", JSON.stringify(searchStrategy, null, 2).slice(0, 200));
    const seenPointer = await client.readResource({ uri: "job-hunter://state/seen-keys" });
    console.log("SeenPointer", JSON.stringify(seenPointer, null, 2).slice(0, 200));

    const { prompts } = await client.listPrompts();
    console.log("Prompts", prompts.map((prompt) => prompt.name));
    const apply = await client.getPrompt({ name: "apply" });
    console.log("ApplyPrompt", JSON.stringify(apply, null, 2).slice(0, 400));
    const rankPrompt = await client.getPrompt({ name: "rank" });
    console.log("RankPrompt", JSON.stringify(rankPrompt, null, 2).slice(0, 200));
    const interviewPrompt = await client.getPrompt({ name: "interview" });
    console.log("InterviewPrompt", JSON.stringify(interviewPrompt, null, 2).slice(0, 200));

    await client.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
