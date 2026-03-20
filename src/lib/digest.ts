import { XMLParser } from "fast-xml-parser";
import { decodeHtmlEntities } from "./html";
import type {
  AudienceTag,
  ContentTag,
  DigestDiagnostic,
  DigestEntry,
  DigestPayload,
  DigestSection,
  DigestTopDevelopment,
  DigestTopicActivity,
  EntryType,
  EvidenceLevel,
  EvidenceSnapshot,
  TopicTag
} from "./digest-types";

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

const TOPIC_RULES: Array<{ tag: TopicTag; label: string; patterns: RegExp[] }> = [
  { tag: "aml", label: "AML", patterns: [/\baml\b/i, /\bacute myeloid leukemia\b/i] },
  { tag: "all", label: "ALL", patterns: [/\ball\b/i, /\bacute lymphoblastic leukemia\b/i] },
  { tag: "lymphoma", label: "Lymphoma", patterns: [/\blymphoma\b/i, /\bhodgkin\b/i, /\bnon-hodgkin\b/i] },
  { tag: "myeloma", label: "Myeloma", patterns: [/\bmyeloma\b/i, /\bmultiple myeloma\b/i] },
  { tag: "mpn", label: "MPN", patterns: [/\bmpn\b/i, /\bmyeloproliferative\b/i, /\bpolycythemia vera\b/i, /\bmyelofibrosis\b/i] },
  { tag: "anemia", label: "Anemia", patterns: [/\banemia\b/i, /\banaemia\b/i, /\bsickle cell\b/i] },
  { tag: "thrombosis", label: "Thrombosis", patterns: [/\bthromb/i, /\bcoagulation\b/i, /\bvenous thromboembolism\b/i] },
  { tag: "transplant", label: "Transplant", patterns: [/\btransplant\b/i, /\bhsct\b/i, /\bstem cell transplant\b/i] }
];

const CONTENT_RULES: Array<{ tag: ContentTag; label: string; patterns: RegExp[] }> = [
  { tag: "guideline", label: "Guideline", patterns: [/\bguideline\b/i, /\bconsensus\b/i, /\brecommendation\b/i] },
  { tag: "approval", label: "Approval", patterns: [/\bapproval\b/i, /\bfda\b/i, /\bema\b/i, /\bapproved\b/i] },
  { tag: "conference", label: "Conference", patterns: [/\bash\b/i, /\beha\b/i, /\basco\b/i, /\bmeeting\b/i, /\bcongress\b/i] },
  { tag: "trial", label: "Trial", patterns: [/\bphase\s*[1-3]\b/i, /\btrial\b/i, /\brandomized\b/i, /\brandomised\b/i] },
  { tag: "review", label: "Review", patterns: [/\breview\b/i, /\bmeta-analysis\b/i, /\bsystematic review\b/i] },
  { tag: "news-update", label: "News", patterns: [/\bpress release\b/i, /\bnews\b/i, /\bupdate\b/i, /\bannounces\b/i] }
];

const TITLE_STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "into",
  "with",
  "without",
  "the",
  "that",
  "this",
  "among",
  "after",
  "before",
  "through",
  "using",
  "use",
  "study",
  "analysis",
  "review",
  "news",
  "update",
  "report"
]);

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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeForDedupe(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticTitleSignature(value: string): string {
  const tokens = normalizeForDedupe(value)
    .split(" ")
    .filter((token) => token.length > 3 && !TITLE_STOP_WORDS.has(token))
    .slice(0, 8)
    .sort();

  return tokens.join(" ");
}

function extractTopics(text: string): TopicTag[] {
  const tags = TOPIC_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(text))).map((rule) => rule.tag);
  return tags.length > 0 ? tags : ["general"];
}

function extractContentTypes(text: string, type: EntryType): ContentTag[] {
  const tags = CONTENT_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(text))).map((rule) => rule.tag);

  if (tags.length > 0) {
    return tags;
  }

  if (type === "news") {
    return ["news-update"];
  }

  return ["research"];
}

function deriveAudiences(contentTypes: ContentTag[], topics: TopicTag[], type: EntryType): AudienceTag[] {
  const audiences = new Set<AudienceTag>(["researchers"]);

  if (contentTypes.includes("guideline") || contentTypes.includes("trial") || topics.includes("thrombosis")) {
    audiences.add("clinicians");
  }

  if (contentTypes.includes("approval") || contentTypes.includes("news-update")) {
    audiences.add("industry");
  }

  if (type === "news" || contentTypes.includes("guideline")) {
    audiences.add("patients");
  }

  return Array.from(audiences);
}

function detectSampleSize(text: string): number | null {
  const match = text.match(/\b(n|sample size)\s*[=:]?\s*(\d{2,5})\b/i) ?? text.match(/\b(\d{2,5})\s+patients\b/i);
  if (!match) {
    return null;
  }

  const raw = match[2] ?? match[1];
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveEvidence(text: string, contentTypes: ContentTag[], type: EntryType): EvidenceSnapshot {
  const lower = text.toLowerCase();
  const sampleSize = detectSampleSize(text);

  let level: EvidenceLevel = "news";
  let studyType = type === "news" ? "News update" : "Research report";
  let phase: string | null = null;

  if (contentTypes.includes("guideline")) {
    level = "guideline";
    studyType = "Guideline / consensus";
  } else if (/phase\s*3/i.test(text)) {
    level = "phase-3";
    studyType = "Interventional trial";
    phase = "Phase 3";
  } else if (/phase\s*2/i.test(text)) {
    level = "phase-2";
    studyType = "Interventional trial";
    phase = "Phase 2";
  } else if (contentTypes.includes("review")) {
    level = "review";
    studyType = "Review / synthesis";
  } else if (/cohort|retrospective|registry|observational/i.test(text)) {
    level = "observational";
    studyType = "Observational study";
  } else if (type !== "news") {
    level = "observational";
    studyType = lower.includes("trial") ? "Interventional trial" : "Research report";
  }

  return {
    level,
    studyType,
    phase,
    sampleSize,
    rationale:
      level === "guideline"
        ? "Likely practice-facing guidance."
        : phase
          ? `Potentially high-impact ${phase.toLowerCase()} evidence.`
          : sampleSize
            ? `Includes an explicit cohort size of ${sampleSize}.`
            : "Evidence level inferred from title and source metadata."
  };
}

function scoreEntry(entry: {
  publishedIso: string | null;
  contentTypes: ContentTag[];
  evidence: EvidenceSnapshot;
  isPrimarySource: boolean;
  type: EntryType;
  topics: TopicTag[];
  source: string;
}): number {
  let score = 10;
  const source = entry.source.toLowerCase();

  if (entry.isPrimarySource) {
    score += 10;
  }

  if (entry.type === "pubmed") {
    score += 8;
  }

  if (entry.contentTypes.includes("guideline")) {
    score += 18;
  }

  if (entry.contentTypes.includes("approval")) {
    score += 16;
  }

  if (entry.contentTypes.includes("trial")) {
    score += 12;
  }

  if (entry.evidence.level === "phase-3") {
    score += 14;
  } else if (entry.evidence.level === "phase-2") {
    score += 10;
  } else if (entry.evidence.level === "review") {
    score += 6;
  }

  if (entry.evidence.sampleSize && entry.evidence.sampleSize >= 100) {
    score += 5;
  }

  if (entry.topics.some((topic) => topic !== "general")) {
    score += 6;
  }

  if (entry.topics.filter((topic) => topic !== "general").length >= 2) {
    score += 2;
  }

  if (source.includes("pubmed") || source.includes("lancet") || source.includes("american journal") || source.includes("leukemia")) {
    score += 6;
  }

  if (source.includes("ash")) {
    score += 4;
  }

  if (entry.publishedIso) {
    const ageInDays = Math.max(0, (Date.now() - Date.parse(entry.publishedIso)) / (24 * 60 * 60 * 1000));
    score += Math.max(0, 12 - ageInDays);
  }

  return Math.round(score);
}

function buildWhyItMatters(
  title: string,
  topics: TopicTag[],
  contentTypes: ContentTag[],
  evidence: EvidenceSnapshot,
  source: string
): DigestEntry["whyItMatters"] {
  const matchedSignals = [
    ...topics.filter((topic) => topic !== "general").map((topic) => `topic:${topic}`),
    ...contentTypes.map((tag) => `content:${tag}`),
    `evidence:${evidence.level}`,
    `source:${source}`
  ].slice(0, 5);

  const readableTopic = topics.find((topic) => topic !== "general") ?? "general hematology";
  const readableContent = contentTypes[0] ?? "research";

  return {
    summary: `${title} was prioritized because it looks relevant to ${readableTopic} and appears to be a ${readableContent} update.`,
    matchedSignals
  };
}

function createEntry(entry: Omit<DigestEntry, "id" | "topics" | "contentTypes" | "audiences" | "evidence" | "score" | "dedupeKey" | "isPrimarySource" | "whyItMatters" | "transparency">): DigestEntry {
  const analysisText = `${entry.title} ${entry.summary} ${entry.source}`;
  const topics = extractTopics(analysisText);
  const contentTypes = extractContentTypes(analysisText, entry.type);
  const audiences = deriveAudiences(contentTypes, topics, entry.type);
  const evidence = deriveEvidence(analysisText, contentTypes, entry.type);
  const isPrimarySource = entry.type !== "news";
  const dedupeKey = normalizeForDedupe(entry.title);
  const score = scoreEntry({
    publishedIso: entry.publishedIso,
    contentTypes,
    evidence,
    isPrimarySource,
    type: entry.type,
    topics,
    source: entry.source
  });

  return {
    ...entry,
    id: `${entry.type}-${slugify(entry.title || entry.link || entry.source)}`,
    topics,
    contentTypes,
    audiences,
    evidence,
    score,
    dedupeKey,
    isPrimarySource,
    whyItMatters: buildWhyItMatters(entry.title, topics, contentTypes, evidence, entry.source),
    transparency: {
      matchedBecause: [
        ...topics.filter((topic) => topic !== "general").map((topic) => `Topic match: ${topic.toUpperCase()}`),
        ...contentTypes.map((tag) => `Content type: ${tag}`)
      ].slice(0, 4),
      sourceType: entry.type,
      ingestedAt: new Date().toISOString()
    }
  };
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
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  const aTime = a.publishedIso ? Date.parse(a.publishedIso) : 0;
  const bTime = b.publishedIso ? Date.parse(b.publishedIso) : 0;
  return bTime - aTime;
}

function dedupeEntries(entries: DigestEntry[]): { dedupedEntries: DigestEntry[]; removedCount: number } {
  const bestByKey = new Map<string, DigestEntry>();
  const bestBySemanticKey = new Map<string, DigestEntry>();

  for (const entry of entries) {
    const existing = bestByKey.get(entry.dedupeKey);
    if (!existing || compareEntries(entry, existing) < 0) {
      bestByKey.set(entry.dedupeKey, entry);
    }
  }

  for (const entry of bestByKey.values()) {
    const semanticKey = `${entry.type}:${semanticTitleSignature(entry.title)}:${entry.topics.filter((topic) => topic !== "general").slice(0, 2).join("-")}`;
    const existing = bestBySemanticKey.get(semanticKey);

    if (!semanticTitleSignature(entry.title)) {
      bestBySemanticKey.set(`${entry.type}:${entry.dedupeKey}`, entry);
      continue;
    }

    if (!existing || compareEntries(entry, existing) < 0) {
      bestBySemanticKey.set(semanticKey, entry);
    }
  }

  const dedupedEntries = Array.from(bestBySemanticKey.values()).sort(compareEntries);
  return {
    dedupedEntries,
    removedCount: Math.max(0, entries.length - dedupedEntries.length)
  };
}

function topicLabel(topic: TopicTag): string {
  const rule = TOPIC_RULES.find((item) => item.tag === topic);
  return rule?.label ?? "General";
}

function buildTopDevelopments(entries: DigestEntry[]): DigestTopDevelopment[] {
  const selected: DigestEntry[] = [];
  const usedTopics = new Set<TopicTag>();

  for (const entry of entries) {
    const primaryTopic = entry.topics.find((topic) => topic !== "general") ?? "general";

    if (selected.length < 3 && (!usedTopics.has(primaryTopic) || primaryTopic === "general")) {
      selected.push(entry);
      usedTopics.add(primaryTopic);
    }

    if (selected.length === 3) {
      break;
    }
  }

  for (const entry of entries) {
    if (selected.length === 3) {
      break;
    }

    if (!selected.some((item) => item.id === entry.id)) {
      selected.push(entry);
    }
  }

  return selected.map((entry) => ({
    id: entry.id,
    title: entry.title,
    summary: entry.whyItMatters.summary,
    source: entry.source,
    link: entry.link,
    topic: entry.topics[0] ?? "general",
    type: entry.type,
    score: entry.score,
    published: entry.published,
    evidenceLevel: entry.evidence.level
  }));
}

function buildTopicActivity(entries: DigestEntry[]): DigestTopicActivity[] {
  const counts = new Map<TopicTag, number>();

  for (const entry of entries) {
    for (const topic of entry.topics.filter((item) => item !== "general")) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([topic, count]) => ({
      topic,
      label: topicLabel(topic),
      count
    }));
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
  const rawEntries = [
    ...pubmedResults.flatMap((result) => result.entries),
    ...feedResults.flatMap((result) => result.entries),
    ...htmlResults.flatMap((result) => result.entries)
  ].sort(compareEntries);
  const { dedupedEntries: entries, removedCount } = dedupeEntries(rawEntries);
  const generatedAt = new Date();

  const sections: DigestSection[] = (["pubmed", "journal", "news"] as EntryType[]).map((id) => {
    const matchingEntries = entries.filter((entry) => entry.type === id);
    const sectionEntries = matchingEntries.slice(0, 50);

    return {
      id,
      label: SECTION_META[id].label,
      description: SECTION_META[id].description,
      count: matchingEntries.length,
      highlightedTopics: Array.from(new Set(matchingEntries.flatMap((entry) => entry.topics.filter((topic) => topic !== "general")))).slice(0, 4),
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
    dedupedEntries: removedCount,
    sources: [
      "PubMed",
      "British Journal of Haematology",
      "Leukemia",
      "American Journal of Hematology",
      "The Lancet",
      "ASH Press Releases"
    ],
    overview: {
      topDevelopments: buildTopDevelopments(entries),
      topicActivity: buildTopicActivity(entries),
      sourceHealth: {
        totalSources: diagnostics.length,
        healthySources: diagnostics.filter((diagnostic) => diagnostic.status === "ok").length,
        degradedSources: diagnostics.filter((diagnostic) => diagnostic.status !== "ok").length
      },
      savedPresetSuggestions: [
        { id: "myeloma-trials", label: "Myeloma Trials", topic: "myeloma", contentType: "trial", audience: "clinicians" },
        { id: "aml-research", label: "AML Research", topic: "aml", contentType: "research", audience: "researchers" },
        { id: "approvals-watch", label: "Approvals Watch", topic: "all", contentType: "approval", audience: "industry" }
      ]
    },
    sections,
    diagnostics
  };
}
