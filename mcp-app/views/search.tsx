import type { DashboardData, DashboardItem, ToolAction } from "../types.ts";
import { list, rec, strings, text } from "../toolviews.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { ActionBar, AppShell, BulletList, DetailsCard, Hero, Notice, Section } from "./_shared.tsx";

export interface SearchViewProps {
	data: DashboardData;
	onAction: (action: ToolAction) => void;
	pending: string | null;
	status?: string;
}

function companyInitial(company?: string): string {
	const initial = (company ?? "").trim().charAt(0).toUpperCase();
	return initial !== "" ? initial : "•";
}

function badgesFor(candidate: DashboardItem): string[] {
	const badges: string[] = [];
	if (candidate.experienceLevel) badges.push(candidate.experienceLevel);
	if (candidate.employmentType) badges.push(candidate.employmentType);
	const place = [candidate.location, candidate.remoteType].filter((part) => part && part !== "").join(" · ");
	if (place !== "") badges.push(place);
	return badges;
}

function JobCardActions(props: {
	candidate: DashboardItem;
	onAction: (action: ToolAction) => void;
	pending: string | null;
}): React.JSX.Element | null {
	const actions = props.candidate.actions ?? (props.candidate.action ? [props.candidate.action] : []);
	if (actions.length === 0) return null;
	const busy = props.pending !== null;
	return (
		<div className="mt-2.5 flex flex-wrap gap-2">
			{actions.map((action, index) => {
				const isPrimary = action.tool !== "research-job";
				return (
					<Button
						key={`${action.tool}-${index}`}
						variant={isPrimary ? "default" : "outline"}
						size="sm"
						disabled={busy}
						aria-label={`${action.label}: ${props.candidate.title}`}
						onClick={() => props.onAction(action)}
					>
						{props.pending === action.label ? "Working…" : action.label}
					</Button>
				);
			})}
		</div>
	);
}

export function SearchView(props: SearchViewProps): React.JSX.Element {
	const { data, onAction, pending } = props;
	const details = rec(data.details);
	const filters = rec(details["filters"]);
	const keywords = text(filters["keywords"]);
	const candidates = data.items ?? [];
	const notes = strings(details["notes"]);
	const errors = strings(details["errors"]);
	const queriesRun = strings(details["queriesRun"]);
	return (
		<AppShell title={data.title ?? "Job search results"} badge="Search" status={props.status}>
		<Hero
			title={`${keywords !== "" ? `"${keywords}"` : "Auto queries"} · ${candidates.length} candidates`}
			badge={<Badge>{candidates.length} candidates</Badge>}
			meta={
				<>
					{text(filters["location"]) !== "" ? `${text(filters["location"])} · ` : ""}
					{queriesRun.length > 0 ? `Ran: ${queriesRun.join("; ")}` : ""}
				</>
			}
		/>

			{candidates.length > 0 ? (
				<Section title={`Candidates (${candidates.length})`}>
					{candidates.map((candidate, index) => {
						const badges = badgesFor(candidate);
						return (
							<article
								key={`${candidate.id ?? candidate.title}-${index}`}
								aria-label={`${candidate.title}${candidate.company ? ` at ${candidate.company}` : ""}`}
								className="flex gap-3"
							>
								<div
									aria-hidden="true"
									className="flex size-11 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-semibold text-secondary-foreground"
								>
									{companyInitial(candidate.company)}
								</div>
								<div className="min-w-0 flex-1">
									<h3 className="text-[15px] leading-snug font-bold break-words">{candidate.title}</h3>
									{candidate.company ? (
										<p className="mt-0.5 text-[13px] text-muted-foreground">{candidate.company}</p>
									) : null}
									{badges.length > 0 || candidate.verdict || candidate.score !== undefined ? (
										<div className="mt-1.5 flex flex-wrap gap-1.5">
											{badges.map((badge) => (
												<Badge key={badge} variant="secondary">
													{badge}
												</Badge>
											))}
											{candidate.verdict || candidate.score !== undefined ? (
												<Badge variant="outline">
													{candidate.score !== undefined ? `${candidate.score}/100` : ""}
													{candidate.score !== undefined && candidate.verdict ? " · " : ""}
													{candidate.verdict ?? ""}
												</Badge>
											) : null}
										</div>
									) : null}
									{candidate.description ? (
										<p className="mt-1.5 text-sm leading-relaxed break-words">{candidate.description}</p>
									) : null}
									{candidate.requirements && candidate.requirements.length > 0 ? (
										<p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
											Key skills: {candidate.requirements.join("; ")}
										</p>
									) : null}
									{candidate.salary || candidate.postedAt ? (
										<p className="mt-1 text-[13px] text-muted-foreground">
											{[candidate.salary, candidate.postedAt ? `Posted ${candidate.postedAt}` : ""]
												.filter((part) => part !== "")
												.join(" · ")}
										</p>
									) : null}
									{candidate.source || candidate.url ? (
										<p className="mt-1.5 text-[13px] text-muted-foreground">
											{candidate.source ? `Source: ${candidate.source}` : "Source"}
											{candidate.url ? (
												<>
													{" · "}
													<a
														className="text-primary underline underline-offset-2"
														href={candidate.url}
														target="_blank"
														rel="noreferrer"
													>
														View original listing ↗
													</a>
												</>
											) : null}
										</p>
									) : null}
									<JobCardActions candidate={candidate} onAction={onAction} pending={pending} />
								</div>
							</article>
						);
					})}
				</Section>
			) : (
				<Section title="Candidates (0)">
					<Notice title="No jobs found">
						<p className="text-sm leading-relaxed">
							This search returned no postings. Broaden the keywords, clear the location or remote filter, or run
							again — adapters only return postings from the last 14 days and never invent listings.
						</p>
					</Notice>
				</Section>
			)}

		{list(details["stale"]).length > 0 || notes.length > 0 ? (
			<Section title="Run notes">
				<BulletList items={notes} />
			</Section>
		) : null}

		{errors.length > 0 ? (
			<Notice variant="destructive" title="Search errors">
				<BulletList items={errors} />
			</Notice>
		) : null}

			<ActionBar actions={data.actions ?? []} onAction={onAction} pending={pending} />
			<DetailsCard markdown={data.markdown} details={data.details} />
		</AppShell>
	);
}
