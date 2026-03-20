import { XMLParser } from "fast-xml-parser";
import { decodeHtmlEntities } from "./html";
import type { DigestDiagnostic, DigestEntry, DigestPayload, DigestSection, EntryType } from "./digest-types";

interface FeedConfig {
  url: string;
  type: Extract<EntryType, "journal" | "news">;
  label: string;
}

interface HtmlSourceConfig {
  url: string;
  type: Extract<EntryType, "journal" | "news">;
  label: string;
}

interface PubMedDocSummary {
  title?: string;
  pubdate?: string;
  source?: string;
  authors?: Array<{ name?: string }>;
}

const RSS_FEEDS: FeedConfig[] = [
  { url: "https://onlinelibrary.wiley.com/feed/13652141/most-recent", type: "journal", label: "British Journal of Haematology" },
  { url: "https://www.nature.com/leu.rss", type: "journal", label: "Leukemia" },
  { url: "https://onlinelibrary.wiley.com/feed/10968652/most-recent", type: "journal", label: "American Journal of Hematology" }
];

const HTML_SOURCES: HtmlSourceConfig[] = [
  {
    url: "https://www.thelancet.com/journals/lancet/home",
    type: "journal",
    label: "The Lancet"
  },
  {
    url: "https://www.hematology.org/newsroom",
    type: "news",
    label: "ASH Press Releases"
  }
];

const PUBMED_QUERIES = [
  "hematology",
  "leukemia OR lymphoma OR myeloma",
  "anemia OR thrombocytopenia"
];

interface FetchResult {
  entries: DigestEntry[];
  diagnostic: DigestDiagnostic;
}

const SECTION_META: Record<EntryType, { label: string; description: string }> = {
  pubmed: {
    label: "PubMed Research",
    description: "Recent PubMed matches for hematology-focused search queries from the last 7 days."
  },
  journal: {
    label: "Journal Articles",
    description: "Latest items from major hematology journals and society publications."
  },
  news: {
    label: "News & Updates",
    description: "Society newsroom updates and announcements relevant to hematology clinicians and researchers."
  }
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  processEntities: false,
  htmlEntities: false
});

const PUBMED_TOOL = "hematology_digest";
const PUBMED_EMAIL = "";

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function cleanText(value: unknown, limit = 320): string {
  if (typeof value !== "string") {
    return "No summary available.";
  }

  const normalized = decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "No summary available.";
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  const truncated = normalized.slice(0, limit - 1).replace(/\s+\S*$/, "").trim();
  return `${truncated}…`;
}

function textValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const text = (value as Record<string, unknown>)["#text"];
    if (typeof text === "string") {
      return text;
    }
  }

  return "";
}

function firstTextValue(...values: unknown[]): string {
  for (const value of values) {
    const text = textValue(value);
    if (text) {
      return text;
    }
  }

  return "";
}

function linkValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const candidate of value) {
      const resolved = linkValue(candidate);
      if (resolved) {
        return resolved;
      }
    }
    return "";
  }

  if (value && typeof value === "object") {
    const href = (value as Record<string, unknown>)["@_href"];
    if (typeof href === "string") {
      return href;
    }

    const rel = (value as Record<string, unknown>)["@_rel"];
    if (rel === "alternate") {
      const alternateHref = (value as Record<string, unknown>)["@_href"];
      if (typeof alternateHref === "string") {
        return alternateHref;
      }
    }

    const text = (value as Record<string, unknown>)["#text"];
    if (typeof text === "string") {
      return text;
    }
  }

  return "";
}

function parseDate(dateString: string): Date | null {
  const parsed = Date.parse(dateString);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed);
}

function parseAshPressReleaseDate(fragment: string): { published: string; publishedIso: string | null } {
  const cleaned = decodeHtmlEntities(fragment).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const match = cleaned.match(
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i
  );

  if (!match) {
    return {
      published: "Recent",
      publishedIso: null
    };
  }

  const published = match[0];
  const parsed = parseDate(published);

  return {
    published,
    publishedIso: parsed?.toISOString() ?? null
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function createEntry(entry: DigestEntry): DigestEntry {
  return entry;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "hematology-digest/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.text();
}

async function fetchJsonWithRetry(url: URL, retries = 3): Promise<any> {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "user-agent": "hematology-digest/1.0"
      }
    });

    if (response.ok) {
      return response.json();
    }

    if (response.status === 429 && attempt < retries - 1) {
      await delay(1000 * 2 ** attempt);
      continue;
    }

    lastError = new Error(`Request failed for ${url.toString()}: ${response.status}`);
    break;
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

async function fetchFeedEntries(feed: FeedConfig): Promise<FetchResult> {
  try {
    const xml = await fetchText(feed.url);
    const parsed = parser.parse(xml) as Record<string, any>;

    const channel = parsed?.rss?.channel ?? parsed?.["rdf:RDF"]?.channel;
    const atomFeed = parsed?.feed;
    const rdfItems = parsed?.["rdf:RDF"]?.item;
    const source = cleanText(textValue(channel?.title) || textValue(atomFeed?.title) || feed.label || "Unknown source", 120);

    const items = ensureArray(channel?.item ?? atomFeed?.entry ?? rdfItems).slice(0, 20);

    const entries = items.map((item) => {
      const published = firstTextValue(item.pubDate, item.published, item.updated) || "No date";
      const parsedDate = parseDate(published);
      const summaryCandidate =
        firstTextValue(item.description, item.summary, item["content:encoded"], item.content) || "No summary available.";
      const resolvedLink = linkValue(item.link) || textValue(item.guid) || textValue(item.id);
      const resolvedTitle = firstTextValue(item.title) || "No title";

      return createEntry({
        title: cleanText(resolvedTitle, 220),
        link: resolvedLink,
        summary: cleanText(summaryCandidate, 320),
        published,
        publishedIso: parsedDate?.toISOString() ?? null,
        source,
        type: feed.type
      });
    });

    return {
      entries,
      diagnostic: {
        kind: "feed",
        id: feed.url,
        label: feed.label,
        status: entries.length > 0 ? "ok" : "empty",
        itemCount: entries.length,
        message: entries.length > 0 ? undefined : "Feed returned no parsable items."
      }
    };
  } catch (error) {
    console.error(`Failed to fetch feed ${feed.url}`, error);

    return {
      entries: [],
      diagnostic: {
        kind: "feed",
        id: feed.url,
        label: feed.label,
        status: "error",
        itemCount: 0,
        message: error instanceof Error ? error.message : "Unknown feed error"
      }
    };
  }
}

async function fetchLancetPubMedFallback(source: HtmlSourceConfig, reason: string): Promise<FetchResult> {
  try {
    const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", "12");
    searchUrl.searchParams.set(
      "term",
      '("Lancet"[Journal] OR "Lancet Haematol"[Journal]) AND (hematology OR leukemia OR lymphoma OR myeloma OR anemia OR thrombocytopenia)'
    );

    if (PUBMED_TOOL) {
      searchUrl.searchParams.set("tool", PUBMED_TOOL);
    }

    if (PUBMED_EMAIL) {
      searchUrl.searchParams.set("email", PUBMED_EMAIL);
    }

    const searchData = (await fetchJsonWithRetry(searchUrl)) as {
      esearchresult?: { idlist?: string[] };
    };

    const ids = ensureArray(searchData.esearchresult?.idlist).slice(0, 12);

    if (ids.length === 0) {
      return {
        entries: [],
        diagnostic: {
          kind: "feed",
          id: source.url,
          label: source.label,
          status: "empty",
          itemCount: 0,
          message: `Homepage blocked (${reason}); PubMed fallback returned no usable Lancet articles.`
        }
      };
    }

    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.searchParams.set("db", "pubmed");
    summaryUrl.searchParams.set("retmode", "json");
    summaryUrl.searchParams.set("id", ids.join(","));

    if (PUBMED_TOOL) {
      summaryUrl.searchParams.set("tool", PUBMED_TOOL);
    }

    if (PUBMED_EMAIL) {
      summaryUrl.searchParams.set("email", PUBMED_EMAIL);
    }

    const summaryData = (await fetchJsonWithRetry(summaryUrl)) as {
      result?: Record<string, PubMedDocSummary>;
    };

    const entries = ids.flatMap((pmid) => {
      const article = summaryData.result?.[pmid];
      if (!article) {
        return [];
      }

      const authorNames = ensureArray(article.authors)
        .map((author) => author?.name?.trim())
        .filter((name): name is string => Boolean(name))
        .slice(0, 3);

      return [
        createEntry({
          title: cleanText(article.title, 220),
          link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          summary: cleanText(`${article.source ?? source.label} | ${authorNames.join(", ") || "Authors unavailable"}`, 220),
          published: article.pubdate ?? "No date",
          publishedIso: null,
          source: source.label,
          type: source.type
        })
      ];
    });

    return {
      entries,
      diagnostic: {
        kind: "feed",
        id: source.url,
        label: source.label,
        status: entries.length > 0 ? "ok" : "empty",
        itemCount: entries.length,
        message: entries.length > 0 ? `Homepage blocked (${reason}); using PubMed fallback.` : `Homepage blocked (${reason}); PubMed fallback returned no usable Lancet articles.`
      }
    };
  } catch (error) {
    return {
      entries: [],
      diagnostic: {
        kind: "feed",
        id: source.url,
        label: source.label,
        status: "error",
        itemCount: 0,
        message: `Homepage blocked (${reason}); PubMed fallback failed: ${getErrorMessage(error)}`
      }
    };
  }
}

function parseLancetHomeDate(fragment: string): { published: string; publishedIso: string | null } {
  const cleaned = decodeHtmlEntities(fragment).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const match = cleaned.match(
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i
  );

  if (!match) {
    return {
      published: "Recent",
      publishedIso: null
    };
  }

  const published = match[0];
  const parsed = parseDate(published);

  return {
    published,
    publishedIso: parsed?.toISOString() ?? null
  };
}

async function fetchHtmlEntries(source: HtmlSourceConfig): Promise<FetchResult> {
  if (source.label === "The Lancet") {
    return fetchLancetHomeEntries(source);
  }

  return fetchAshPressReleaseEntries(source);
}

async function fetchLancetHomeEntries(source: HtmlSourceConfig): Promise<FetchResult> {
  try {
    const html = await fetchText(source.url);
    const matches = Array.from(
      html.matchAll(/<a[^>]+href="(\/journals\/lancet\/article\/[^"]+)"[^>]*>(.*?)<\/a>/gsi)
    );

    const seen = new Set<string>();
    const entries: DigestEntry[] = [];

    for (const match of matches) {
      const path = match[1];
      const rawTitle = match[2];
      const title = cleanText(rawTitle, 220);
      const contextFragment = html.slice(match.index ?? 0, (match.index ?? 0) + 1800);
      const { published, publishedIso } = parseLancetHomeDate(contextFragment);

      if (!path || !title || title === "No summary available." || seen.has(path)) {
        continue;
      }

      seen.add(path);
      entries.push(
        createEntry({
          title,
          link: new URL(path, source.url).toString(),
          summary: "Recent article surfaced from The Lancet journal homepage.",
          published,
          publishedIso,
          source: source.label,
          type: source.type
        })
      );

      if (entries.length >= 20) {
        break;
      }
    }

    return {
      entries,
      diagnostic: {
        kind: "feed",
        id: source.url,
        label: source.label,
        status: entries.length > 0 ? "ok" : "empty",
        itemCount: entries.length,
        message: entries.length > 0 ? undefined : "No Lancet article links were parsed from the journal homepage."
      }
    };
  } catch (error) {
    console.error(`Failed to fetch HTML source ${source.url}`, error);

    if (error instanceof Error && error.message.includes(": 403")) {
      return fetchLancetPubMedFallback(source, "403");
    }

    return {
      entries: [],
      diagnostic: {
        kind: "feed",
        id: source.url,
        label: source.label,
        status: "error",
        itemCount: 0,
        message: error instanceof Error ? error.message : "Unknown HTML source error"
      }
    };
  }
}

async function fetchAshPressReleaseEntries(source: HtmlSourceConfig): Promise<FetchResult> {
  try {
    const html = await fetchText(source.url);
    const matches = Array.from(html.matchAll(/<a[^>]+href="(\/newsroom\/press-releases\/[^"]+)"[^>]*>(.*?)<\/a>/gsi));

    const seen = new Set<string>();
    const entries: DigestEntry[] = [];

    for (const match of matches) {
      const path = match[1];
      const rawTitle = match[2];
      const title = cleanText(rawTitle, 220);
      const afterLinkFragment = html.slice(match.index ?? 0, (match.index ?? 0) + 1400);
      const { published, publishedIso } = parseAshPressReleaseDate(afterLinkFragment);

      if (!path || !title || title === "No summary available." || seen.has(path)) {
        continue;
      }

      seen.add(path);
      entries.push(
        createEntry({
          title,
          link: new URL(path, source.url).toString(),
          summary: "Press release from the American Society of Hematology newsroom.",
          published,
          publishedIso,
          source: source.label,
          type: source.type
        })
      );

      if (entries.length >= 20) {
        break;
      }
    }

    return {
      entries,
      diagnostic: {
        kind: "feed",
        id: source.url,
        label: source.label,
        status: entries.length > 0 ? "ok" : "empty",
        itemCount: entries.length,
        message: entries.length > 0 ? undefined : "No press release links were parsed from the newsroom page."
      }
    };
  } catch (error) {
    return {
      entries: [],
      diagnostic: {
        kind: "feed",
        id: source.url,
        label: source.label,
        status: "error",
        itemCount: 0,
        message: getErrorMessage(error)
      }
    };
  }
}

async function fetchPubMedEntries(query: string, daysBack = 7): Promise<FetchResult> {
  try {
    const now = new Date();
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const dateRange = `${startDate.toISOString().slice(0, 10).replace(/-/g, "/")}:${now
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "/")}[pdat]`;

    const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("term", `${query} AND ${dateRange}`);
    searchUrl.searchParams.set("retmax", "25");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("tool", PUBMED_TOOL);
    if (PUBMED_EMAIL) {
      searchUrl.searchParams.set("email", PUBMED_EMAIL);
    }

    const searchData = (await fetchJsonWithRetry(searchUrl)) as {
      esearchresult?: { idlist?: string[] };
    };
    const ids = searchData.esearchresult?.idlist ?? [];

    if (ids.length === 0) {
      return {
        entries: [],
        diagnostic: {
          kind: "pubmed",
          id: query,
          label: query,
          status: "empty",
          itemCount: 0,
          message: "PubMed returned no matching IDs."
        }
      };
    }

    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.searchParams.set("db", "pubmed");
    summaryUrl.searchParams.set("id", ids.join(","));
    summaryUrl.searchParams.set("retmode", "json");
    summaryUrl.searchParams.set("tool", PUBMED_TOOL);
    if (PUBMED_EMAIL) {
      summaryUrl.searchParams.set("email", PUBMED_EMAIL);
    }

    const summaryData = (await fetchJsonWithRetry(summaryUrl)) as {
      result?: Record<string, PubMedDocSummary>;
    };

    const entries = ids.flatMap((pmid) => {
      const article = summaryData.result?.[pmid];
      if (!article) {
        return [];
      }

      const authorNames = ensureArray(article.authors)
        .map((author) => author?.name?.trim())
        .filter((name): name is string => Boolean(name))
        .slice(0, 3);

      return [
        createEntry({
          title: cleanText(article.title, 220),
          link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          summary: cleanText(`${article.source ?? "PubMed"} | ${authorNames.join(", ") || "Authors unavailable"}`, 220),
          published: article.pubdate ?? "No date",
          publishedIso: null,
          source: "PubMed",
          type: "pubmed"
        })
      ];
    });

    return {
      entries,
      diagnostic: {
        kind: "pubmed",
        id: query,
        label: query,
        status: entries.length > 0 ? "ok" : "empty",
        itemCount: entries.length,
        message: entries.length > 0 ? undefined : "PubMed summaries returned no usable records."
      }
    };
  } catch (error) {
    console.error(`Failed to fetch PubMed query "${query}"`, error);

    return {
      entries: [],
      diagnostic: {
        kind: "pubmed",
        id: query,
        label: query,
        status: "error",
        itemCount: 0,
        message: error instanceof Error ? error.message : "Unknown PubMed error"
      }
    };
  }
}

function compareEntries(a: DigestEntry, b: DigestEntry): number {
  const aTime = a.publishedIso ? Date.parse(a.publishedIso) : 0;
  const bTime = b.publishedIso ? Date.parse(b.publishedIso) : 0;
  return bTime - aTime;
}

export async function getDigestData(): Promise<DigestPayload> {
  const pubmedResults: FetchResult[] = [];
  for (const query of PUBMED_QUERIES) {
    pubmedResults.push(await fetchPubMedEntries(query));
    await delay(400);
  }

  const [feedResults, htmlResults] = await Promise.all([
    Promise.all(RSS_FEEDS.map((feed) => fetchFeedEntries(feed))),
    Promise.all(HTML_SOURCES.map((source) => fetchHtmlEntries(source)))
  ]);

  const diagnostics = [...pubmedResults, ...feedResults, ...htmlResults].map((result) => result.diagnostic);
  const entries = [
    ...pubmedResults.flatMap((result) => result.entries),
    ...feedResults.flatMap((result) => result.entries),
    ...htmlResults.flatMap((result) => result.entries)
  ].sort(compareEntries);
  const generatedAt = new Date();

  const sections: DigestSection[] = (["pubmed", "journal", "news"] as EntryType[]).map((id) => {
    const matchingEntries = entries.filter((entry) => entry.type === id);
    const sectionEntries = matchingEntries.slice(0, 50);

    return {
      id,
      label: SECTION_META[id].label,
      description: SECTION_META[id].description,
      count: matchingEntries.length,
      entries: sectionEntries
    };
  });

  return {
    site: {
      title: "Hematology Digest",
      tagline: "Daily aggregated research, publications, and news from top hematology sources.",
      description: "Static hematology briefing built with Astro and a TypeScript data pipeline."
    },
    generatedAt: generatedAt.toISOString(),
    generatedAtDisplay: generatedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC",
    totalEntries: entries.length,
    sources: [
      "PubMed",
      "British Journal of Haematology",
      "Leukemia",
      "American Journal of Hematology",
      "The Lancet",
      "ASH Press Releases"
    ],
    sections,
    diagnostics
  };
}
