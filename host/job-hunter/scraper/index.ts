import type { Adapter, Job, JobDetail, SearchAllOptions, SearchQuery } from "./types.ts";
import { dedupeJobs, jobMatchesQuery, sortNewestFirst } from "./helpers.ts";
import { remotive } from "./adapters/remotive.ts";
import { indeed, linkedin } from "./adapters/tsjobspy.ts";
import { remoteok } from "./adapters/remoteok.ts";
import { wwr } from "./adapters/wwr.ts";
import { hn } from "./adapters/hn.ts";
import { jobberman } from "./adapters/jobberman.ts";
import { myjobmag } from "./adapters/myjobmag.ts";

export const adapters: Adapter[] = [
  indeed,
  linkedin,
  remotive,
  remoteok,
  wwr,
  hn,
  jobberman,
  myjobmag,
];

export async function searchAll(q: SearchQuery, options: SearchAllOptions = {}): Promise<Job[]> {
  const sources = options.adapters ?? adapters;
  const results = await Promise.allSettled(sources.map((adapter) => adapter.search(q)));

  const jobs = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const filtered = jobs.filter((job) => jobMatchesQuery(job, q));
  const deduped = dedupeJobs(filtered);
  const sorted = sortNewestFirst(deduped);

  return q.limit && q.limit > 0 ? sorted.slice(0, q.limit) : sorted;
}

export function searchSource(name: string, q: SearchQuery): Promise<Job[]> {
  const adapter = adapters.find((candidate) => candidate.name === name);
  if (!adapter) {
    throw new Error(`Unknown scraper adapter '${name}'. Registered: ${adapters.map((a) => a.name).join(", ")}`);
  }
  return adapter.search(q);
}

export type { Adapter, Job, JobDetail, SearchAllOptions, SearchQuery } from "./types.ts";
export { clearHttpCache, httpCacheStats } from "./http.ts";
export { fetchLinkedInDetail, linkedInCanonicalUrl, parseLinkedInJobId, parseLinkedInSearch } from "./adapters/linkedin.ts";
