import * as cheerio from "cheerio";
import { DETAIL_CACHE_TTL_MS } from "./cache.ts";
import { get } from "./http.ts";
import { cleanText, firstNonEmpty, htmlToText, splitHeadline } from "./helpers.ts";
import type { Job, JobDetail } from "./types.ts";

/**
 * Remotive-only detail resolution (locked spec Q6=a):
 * search hits already carry the full description, so reuse it.
 * Re-fetch the job page only when the description is missing/stale.
 */

/** Pure extractor (no network): exported for unit tests. */
export function extractDetailText(html: string): string {
  const $ = cheerio.load(html);
  const generic = $("article").first().text() || $("main").first().text() || $("body").text();
  return htmlToText(generic).slice(0, 8000);
}

/**
 * Resolve a job's full description: reuse the search-hit description when
 * present, otherwise re-fetch the job URL once. Returns undefined only when
 * both are empty.
 */
export async function fetchJobDetailText(job: Job): Promise<string | undefined> {
  if (job.description && job.description.trim().length > 0) {
    return job.description;
  }
  try {
    const html = await get(job.url, { cacheTtlMs: DETAIL_CACHE_TTL_MS });
    const text = extractDetailText(html);
    return text || undefined;
  } catch {
    return undefined;
  }
}

/** Fetch a standalone job page (detail command for Remotive URLs). */
export async function fetchPageDetail(url: string): Promise<JobDetail> {
  const html = await get(url, { cacheTtlMs: DETAIL_CACHE_TTL_MS });
  const host = new URL(url).hostname;
  const $ = cheerio.load(html);
  const rawTitle = firstNonEmpty(
    $('meta[property="og:title"]').attr("content"),
    $("h1").first().text(),
    $("title").first().text(),
  ) ?? url;
  // Detail headlines carry site suffixes ("Role at Acme | Remotive").
  const { title, company: headlineCompany } = splitHeadline(rawTitle.split("|")[0]?.trim() ?? rawTitle);
  const shortHost = host.replace(/^www\./, "");
  return {
    id: `remotive:${url}`,
    source: "remotive",
    title: cleanText(title),
    company: headlineCompany ?? shortHost,
    url,
    description: extractDetailText(html),
  };
}

export function isEnrichable(job: Job): boolean {
  return !job.description || job.description.trim().length === 0;
}
