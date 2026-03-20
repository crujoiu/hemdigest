import type { AudienceTag, ContentTag, DigestDiagnostic, DigestEntry, DigestPayload, DigestSection, TherapyTag, TopicTag } from "./digest-types";

const SECTION_PAGE_SIZE = 12;
const THEME_STORAGE_KEY = "theme";
const FILTER_STORAGE_KEY = "digest-filters";
const BOOKMARK_STORAGE_KEY = "digest-bookmarks";
const SEEN_STORAGE_KEY = "digest-seen-items";
const ENTRY_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});
const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium"
});
const DOMAIN_SEARCH_CONCEPTS: Array<{ topic: TopicTag; aliases: string[] }> = [
  { topic: "aml", aliases: ["aml", "acute myeloid leukemia", "acute myelogenous leukemia"] },
  { topic: "lymphoma", aliases: ["lymphoma", "hodgkin", "non-hodgkin", "nhl", "hodgkin lymphoma"] },
  { topic: "myeloma", aliases: ["myeloma", "multiple myeloma", "mm"] },
  { topic: "mpn", aliases: ["mpn", "myeloproliferative", "myelofibrosis", "polycythemia vera", "essential thrombocythemia"] },
  { topic: "anemia", aliases: ["anemia", "anaemia", "sickle cell", "hemolytic anemia"] },
  { topic: "thrombosis", aliases: ["thrombosis", "thromboembolism", "vte", "coagulation", "venous thromboembolism"] },
  { topic: "transplant", aliases: ["transplant", "hsct", "bmt", "bone marrow transplant", "stem cell transplant"] },
  { topic: "benign", aliases: ["benign hematology", "itp", "hemophilia", "thalassemia"] }
];
const THERAPY_SEARCH_CONCEPTS: Array<{ tag: TherapyTag; aliases: string[] }> = [
  { tag: "car-t", aliases: ["car-t", "cart", "chimeric antigen receptor t", "cell therapy"] },
  { tag: "bispecific", aliases: ["bispecific", "bispecific antibody", "t-cell engager", "t cell engager"] },
  { tag: "anticoagulation", aliases: ["anticoagulation", "doac", "warfarin", "heparin", "apixaban", "rivaroxaban"] },
  { tag: "transplant-conditioning", aliases: ["conditioning", "myeloablative", "reduced intensity", "nonmyeloablative"] },
  { tag: "stem-cell-transplant", aliases: ["hsct", "bmt", "stem cell transplant", "bone marrow transplant", "allogeneic transplant"] },
  { tag: "targeted-therapy", aliases: ["targeted therapy", "tki", "jak inhibitor", "btk inhibitor", "tyrosine kinase inhibitor"] }
];

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as T;
}

function hasDigestPageElements(): boolean {
  const requiredIds = [
    "digest-title",
    "digest-tagline",
    "digest-updated",
    "digest-total",
    "digest-coverage",
    "digest-deduped",
    "section-nav",
    "digest-sections",
    "digest-error",
    "back-to-top",
    "loading-overlay",
    "theme-toggle",
    "overview-health",
    "overview-metrics",
    "overview-spotlight",
    "overview-presets",
    "digest-search",
    "topic-filter",
    "content-filter",
    "audience-filter",
    "therapy-filter",
    "preset-filter",
    "search-assist",
    "bookmarks-toggle",
    "new-toggle",
    "clear-filters",
    "active-filters"
  ];

  return requiredIds.every((id) => document.getElementById(id));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function titleCase(value: string): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatRelativeDateLabel(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return DATE_ONLY_FORMATTER.format(new Date(parsed));
}

function renderNav(target: HTMLElement, sections: DigestSection[]): void {
  target.innerHTML = sections
    .map(
      (section) => `
        <a href="#${escapeAttribute(section.id)}" class="section-nav__link">
          <span>${escapeHtml(section.label)}</span>
          <span class="section-nav__count">${section.count}</span>
        </a>
      `
    )
    .join("");
}

function renderEntryTags(values: string[], className: string): string {
  return values
    .map((value) => `<span class="${className}">${escapeHtml(titleCase(value))}</span>`)
    .join("");
}

function formatTherapyLabel(value: TherapyTag): string {
  switch (value) {
    case "car-t":
      return "CAR-T";
    case "transplant-conditioning":
      return "Conditioning";
    case "stem-cell-transplant":
      return "Stem Cell Transplant";
    case "targeted-therapy":
      return "Targeted Therapy";
    default:
      return titleCase(value);
  }
}

function renderTherapyTags(values: TherapyTag[], className: string): string {
  return values
    .map((value) => `<span class="${className}">${escapeHtml(formatTherapyLabel(value))}</span>`)
    .join("");
}

function renderOverflowTag(count: number, className: string): string {
  if (count <= 0) {
    return "";
  }

  return `<span class="${className} ${className}--overflow">+${count}</span>`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightSearchMatches(value: string, query: string): string {
  const tokens = Array.from(new Set(getSearchTokens(query).filter((token) => token.length >= 2))).sort(
    (left, right) => right.length - left.length
  );

  if (tokens.length === 0) {
    return escapeHtml(value);
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts = value.split(pattern);

  return parts
    .map((part) => {
      if (!part) {
        return "";
      }

      return tokens.some((token) => token.toLowerCase() === part.toLowerCase())
        ? `<mark class="search-highlight">${escapeHtml(part)}</mark>`
        : escapeHtml(part);
    })
    .join("");
}

function getSearchMatchHints(entry: DigestEntry, query: string): string[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  const terms = getExpandedSearchTerms(normalizedQuery);
  const title = normalizeSearchText(entry.title);
  const summary = normalizeSearchText(entry.summary);
  const source = normalizeSearchText(entry.source);
  const topics = entry.topics.map((topic) => normalizeSearchText(topic));
  const contentTypes = entry.contentTypes.map((contentType) => normalizeSearchText(contentType));
  const audiences = entry.audiences.map((audience) => normalizeSearchText(audience));
  const hints = new Set<string>();

  if (title.includes(normalizedQuery) || terms.some((term) => title.includes(term))) {
    hints.add("title");
  }

  if (topics.includes(normalizedQuery) || terms.some((term) => topics.includes(term))) {
    hints.add("topic");
  }

  if (
    contentTypes.includes(normalizedQuery) ||
    audiences.includes(normalizedQuery) ||
    terms.some((term) => contentTypes.includes(term) || audiences.includes(term))
  ) {
    hints.add("tags");
  }

  if (summary.includes(normalizedQuery) || terms.some((term) => summary.includes(term))) {
    hints.add("summary");
  }

  if (source.includes(normalizedQuery) || terms.some((term) => source.includes(term))) {
    hints.add("source");
  }

  return Array.from(hints).slice(0, 3);
}

function renderEntries(entries: DigestEntry[], searchQuery = ""): string {
  return entries
    .map(
      (entry) => {
        const visibleTopics = entry.topics.filter((topic) => topic !== "general").slice(0, 2);
        const hiddenTopicCount = Math.max(entry.topics.filter((topic) => topic !== "general").length - visibleTopics.length, 0);
        const visibleTherapies = entry.therapySignals.slice(0, 2);
        const hiddenTherapyCount = Math.max(entry.therapySignals.length - visibleTherapies.length, 0);
        const taxonomyTags = [...entry.contentTypes, ...entry.audiences];
        const visibleTaxonomyTags = taxonomyTags.slice(0, 3);
        const hiddenTaxonomyCount = Math.max(taxonomyTags.length - visibleTaxonomyTags.length, 0);
        const evidenceSummary = [
          titleCase(entry.evidence.level),
          entry.evidence.studyType,
          entry.evidence.phase,
          entry.evidence.sampleSize ? `n=${entry.evidence.sampleSize}` : ""
        ]
          .filter(Boolean)
          .join(" • ");
        const transparencySummary = entry.transparency.matchedBecause.slice(0, 2).join(" • ") || "Matched by source and text signals";
        const searchMatchHints = getSearchMatchHints(entry, searchQuery);
        const searchHintMarkup =
          searchMatchHints.length > 0
            ? `
          <p class="entry-card__search-match">
            Matched in ${escapeHtml(searchMatchHints.map((hint) => titleCase(hint)).join(" • "))}
          </p>
        `
            : "";

        return `
        <article class="entry-card entry-card--${escapeAttribute(entry.type)}">
          <div class="entry-card__topline">
            <div class="entry-card__badges">
              <span class="entry-card__badge entry-card__badge--${escapeAttribute(entry.type)}">${escapeHtml(entry.type)}</span>
              ${renderEntryTags(visibleTopics, "entry-card__tag")}
              ${renderOverflowTag(hiddenTopicCount, "entry-card__tag")}
            </div>
            <button class="entry-card__bookmark" type="button" data-entry-id="${escapeAttribute(entry.id)}" aria-pressed="false">
              Save
            </button>
          </div>

          <h3 class="entry-card__title">
            <a href="${escapeAttribute(entry.link)}" target="_blank" rel="noreferrer">${highlightSearchMatches(entry.title, searchQuery)}</a>
          </h3>

          <p class="entry-card__summary">${highlightSearchMatches(entry.summary, searchQuery)}</p>
          ${searchHintMarkup}
          <div class="entry-card__why-block">
            <p class="entry-card__why-label">Why it matters</p>
            <p class="entry-card__why">${escapeHtml(entry.whyItMatters.summary)}</p>
          </div>
          <div class="entry-card__therapies">
            ${renderTherapyTags(visibleTherapies, "entry-card__therapy-tag")}
            ${renderOverflowTag(hiddenTherapyCount, "entry-card__therapy-tag")}
          </div>
          <div class="entry-card__taxonomy">
            ${renderEntryTags(visibleTaxonomyTags, "entry-card__taxonomy-tag")}
            ${renderOverflowTag(hiddenTaxonomyCount, "entry-card__taxonomy-tag")}
          </div>

          <div class="entry-card__meta entry-card__meta--primary">
            <span>${escapeHtml(entry.source)}</span>
            <time datetime="${entry.publishedIso ? escapeAttribute(entry.publishedIso) : ""}">${escapeHtml(formatEntryDate(entry))}</time>
            <span>Score ${entry.score}</span>
          </div>
          <div class="entry-card__meta entry-card__meta--secondary">
            <span>${escapeHtml(evidenceSummary || entry.evidence.rationale)}</span>
            <span>${escapeHtml(transparencySummary)}</span>
          </div>
        </article>
      `;
      }
    )
    .join("");
}

function formatEntryDate(entry: DigestEntry): string {
  const rawValue = entry.publishedIso ?? entry.published;
  const parsed = Date.parse(rawValue);

  if (Number.isNaN(parsed)) {
    return entry.published;
  }

  return (entry.publishedIso ? ENTRY_DATE_FORMATTER : DATE_ONLY_FORMATTER).format(new Date(parsed));
}

function formatGeneratedAt(generatedAt: string, fallback: string): string {
  const parsed = Date.parse(generatedAt);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return ENTRY_DATE_FORMATTER.format(new Date(parsed));
}

interface FilterState {
  search: string;
  topic: TopicTag | "all";
  contentType: ContentTag | "all";
  audience: AudienceTag | "all";
  therapy: TherapyTag | "all";
  bookmarksOnly: boolean;
  newOnly: boolean;
  activePresetId: string;
}

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getInitialFilterState(): FilterState {
  const defaults: FilterState = {
    search: "",
    topic: "all",
    contentType: "all",
    audience: "all",
    therapy: "all",
    bookmarksOnly: false,
    newOnly: false,
    activePresetId: ""
  };

  return {
    ...defaults,
    ...readJsonStorage<Partial<FilterState>>(FILTER_STORAGE_KEY, defaults)
  };
}

function getBookmarks(): string[] {
  return readJsonStorage<string[]>(BOOKMARK_STORAGE_KEY, []);
}

function getSeenEntries(): string[] {
  return readJsonStorage<string[]>(SEEN_STORAGE_KEY, []);
}

function isEntryNew(entry: DigestEntry, seenEntries: Set<string>): boolean {
  return !seenEntries.has(entry.id);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function getSearchTokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean);
}

function getExpandedSearchTerms(query: string): string[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  const terms = new Set<string>([normalizedQuery, ...getSearchTokens(normalizedQuery)]);

  for (const concept of DOMAIN_SEARCH_CONCEPTS) {
    const matched = concept.aliases.some((alias) => normalizedQuery.includes(alias) || terms.has(alias));

    if (!matched) {
      continue;
    }

    terms.add(concept.topic);
    for (const alias of concept.aliases) {
      terms.add(alias);
      for (const token of getSearchTokens(alias)) {
        terms.add(token);
      }
    }
  }

  return Array.from(terms).filter(Boolean);
}

function findMatchingSearchConcepts(query: string): Array<{ topic: TopicTag; aliases: string[] }> {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  const terms = getExpandedSearchTerms(normalizedQuery);

  return DOMAIN_SEARCH_CONCEPTS.filter(
    (concept) =>
      terms.includes(concept.topic) ||
      concept.aliases.some(
        (alias) =>
          normalizedQuery.includes(alias) ||
          alias.includes(normalizedQuery) ||
          terms.includes(alias)
      )
  );
}

function findMatchingTherapyConcepts(query: string): Array<{ tag: TherapyTag; aliases: string[] }> {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  return THERAPY_SEARCH_CONCEPTS.filter((therapy) =>
    therapy.aliases.some((alias) => normalizedQuery.includes(alias) || alias.includes(normalizedQuery))
  );
}

function getTopicDisplayLabel(topic: TopicTag): string {
  return topic === "aml" || topic === "mpn" ? topic.toUpperCase() : titleCase(topic);
}

function getTherapyDisplayLabel(therapy: TherapyTag): string {
  return therapy ? formatTherapyLabel(therapy) : "Therapy";
}

function renderSearchAssist(target: HTMLElement, filterState: FilterState): void {
  const matchingConcepts = findMatchingSearchConcepts(filterState.search).slice(0, 2);
  const matchingTherapies = findMatchingTherapyConcepts(filterState.search).slice(0, 2);

  if (matchingConcepts.length === 0 && matchingTherapies.length === 0 && !filterState.search) {
    const quickStarts = [
      { label: "AML", query: "AML" },
      { label: "Multiple myeloma", query: "multiple myeloma" },
      { label: "HSCT", query: "HSCT" },
      { label: "VTE", query: "VTE" }
    ];

    target.innerHTML = `
      <p class="search-assist__label">Try a quick search</p>
      <div class="search-assist__actions">
        ${quickStarts
          .map(
            (item) => `
              <button class="search-assist__chip" type="button" data-search-query="${escapeAttribute(item.query)}">
                ${escapeHtml(item.label)}
              </button>
            `
          )
          .join("")}
      </div>
    `;
    return;
  }

  if (matchingConcepts.length === 0 && matchingTherapies.length === 0) {
    target.innerHTML = "";
    return;
  }

  const topicMarkup = matchingConcepts
    .map((concept) => {
      const leadAlias = concept.aliases.find((alias) => alias.length > concept.topic.length) ?? concept.aliases[0];

      return `
        <div class="search-assist__group">
          <p class="search-assist__label">Recognized ${escapeHtml(filterState.search)} as ${escapeHtml(getTopicDisplayLabel(concept.topic))}</p>
          <div class="search-assist__actions">
            <button class="search-assist__chip" type="button" data-topic-value="${escapeAttribute(concept.topic)}">
              Filter to ${escapeHtml(getTopicDisplayLabel(concept.topic))}
            </button>
            <button class="search-assist__chip search-assist__chip--secondary" type="button" data-search-query="${escapeAttribute(leadAlias)}">
              Search ${escapeHtml(leadAlias)}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  const therapyMarkup = matchingTherapies
    .map(
      (therapy) => `
          <div class="search-assist__group">
            <p class="search-assist__label">Recognized ${escapeHtml(filterState.search)} as ${escapeHtml(getTherapyDisplayLabel(therapy.tag))}</p>
            <div class="search-assist__actions">
              <button class="search-assist__chip" type="button" data-therapy-value="${escapeAttribute(therapy.tag)}">
                Filter to ${escapeHtml(getTherapyDisplayLabel(therapy.tag))}
              </button>
            </div>
          </div>
        `
      )
    .join("");

  target.innerHTML = `${topicMarkup}${therapyMarkup}`;
}

function getSearchScore(entry: DigestEntry, query: string): number {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return 0;
  }

  const terms = getExpandedSearchTerms(normalizedQuery);
  const title = normalizeSearchText(entry.title);
  const summary = normalizeSearchText(entry.summary);
  const source = normalizeSearchText(entry.source);
  const topics = entry.topics.map((topic) => normalizeSearchText(topic));
  const contentTypes = entry.contentTypes.map((contentType) => normalizeSearchText(contentType));
  const audiences = entry.audiences.map((audience) => normalizeSearchText(audience));
  let score = 0;

  if (title.includes(normalizedQuery)) {
    score += title.startsWith(normalizedQuery) ? 18 : 12;
  }

  if (topics.includes(normalizedQuery)) {
    score += 10;
  }

  if (contentTypes.includes(normalizedQuery) || audiences.includes(normalizedQuery)) {
    score += 7;
  }

  if (source.includes(normalizedQuery)) {
    score += 4;
  }

  if (summary.includes(normalizedQuery)) {
    score += 3;
  }

  for (const term of terms) {
    if (term === normalizedQuery) {
      continue;
    }

    if (title.includes(term)) {
      score += term.includes(" ") ? 6 : 4;
    }

    if (topics.includes(term)) {
      score += 5;
    }

    if (contentTypes.includes(term) || audiences.includes(term)) {
      score += 3;
    }

    if (summary.includes(term)) {
      score += term.includes(" ") ? 2.5 : 1.5;
    }

    if (source.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function matchesFilter(entry: DigestEntry, filterState: FilterState, bookmarks: Set<string>, seenEntries: Set<string>): boolean {
  if (filterState.search && getSearchScore(entry, filterState.search) <= 0) {
    return false;
  }

  if (filterState.topic !== "all" && !entry.topics.includes(filterState.topic)) {
    return false;
  }

  if (filterState.contentType !== "all" && !entry.contentTypes.includes(filterState.contentType)) {
    return false;
  }

  if (filterState.audience !== "all" && !entry.audiences.includes(filterState.audience)) {
    return false;
  }

  if (filterState.therapy !== "all" && !entry.therapySignals.includes(filterState.therapy)) {
    return false;
  }

  if (filterState.bookmarksOnly && !bookmarks.has(entry.id)) {
    return false;
  }

  if (filterState.newOnly && !isEntryNew(entry, seenEntries)) {
    return false;
  }

  return true;
}

function markSeenEntries(sections: DigestSection[]): void {
  const nextSeen = new Set(getSeenEntries());
  for (const entry of sections.flatMap((section) => section.entries)) {
    nextSeen.add(entry.id);
  }
  writeJsonStorage(SEEN_STORAGE_KEY, Array.from(nextSeen));
}

function renderOverview(
  payload: DigestPayload,
  filteredSections: DigestSection[],
  filterState: FilterState,
  healthEl: HTMLElement,
  metricsEl: HTMLElement,
  spotlightEl: HTMLElement,
  presetsEl: HTMLElement,
  activePresetId: string
): void {
  const filteredEntries = filteredSections.flatMap((section) => section.entries);
  const activeTopics = Array.from(
    new Set(
      filteredEntries
        .flatMap((entry) => entry.topics)
        .filter((topic) => topic !== "general")
    )
  );
  const filteredTopicActivity = activeTopics
    .map((topic) => ({
      topic,
      label: getTopicDisplayLabel(topic),
      count: filteredEntries.filter((entry) => entry.topics.includes(topic)).length
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const activeTherapies = Array.from(new Set(filteredEntries.flatMap((entry) => entry.therapySignals)));
  const filteredTherapyActivity = activeTherapies
    .map((therapy) => ({
      therapy,
      label: getTherapyDisplayLabel(therapy),
      count: filteredEntries.filter((entry) => entry.therapySignals.includes(therapy)).length
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const spotlightEntries = filteredEntries
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const healthy = payload.overview.sourceHealth.healthySources;
  const total = payload.overview.sourceHealth.totalSources;
  const hasActiveFilters =
    Boolean(normalizeSearchText(filterState.search)) ||
    filterState.topic !== "all" ||
    filterState.contentType !== "all" ||
    filterState.audience !== "all" ||
    filterState.therapy !== "all" ||
    filterState.bookmarksOnly ||
    filterState.newOnly ||
    Boolean(filterState.activePresetId);
  const topicActivity = filteredTopicActivity.slice(0, 3).map((item) => `${item.label} ${item.count}`).join(" • ");
  const therapyActivity = filteredTherapyActivity.slice(0, 2).map((item) => `${item.label} ${item.count}`).join(" • ");

  healthEl.textContent = hasActiveFilters
    ? `${filteredEntries.length} filtered results across ${filteredSections.length} streams. ${therapyActivity || topicActivity || "Refine filters to focus the briefing further."}`
    : `${healthy}/${total} source pipelines healthy. ${therapyActivity || topicActivity || "Topic activity will appear as feeds populate."}`;
  metricsEl.innerHTML = [
    `<article class="overview-card"><p class="overview-card__label">${hasActiveFilters ? "Visible results" : "Top developments"}</p><strong>${hasActiveFilters ? filteredEntries.length : payload.overview.topDevelopments.length}</strong></article>`,
    `<article class="overview-card"><p class="overview-card__label">${hasActiveFilters ? "Visible streams" : "Duplicates removed"}</p><strong>${hasActiveFilters ? filteredSections.length : payload.dedupedEntries}</strong></article>`,
    `<article class="overview-card"><p class="overview-card__label">Active topics</p><strong>${filteredTopicActivity.length}</strong></article>`,
    `<article class="overview-card"><p class="overview-card__label">Active therapies</p><strong>${filteredTherapyActivity.length}</strong></article>`
  ].join("");
  spotlightEl.innerHTML = (hasActiveFilters
    ? spotlightEntries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        summary: entry.whyItMatters.summary,
        source: entry.source,
        link: entry.link,
        topic: entry.topics.find((topic) => topic !== "general") ?? "general",
        therapySignal: entry.therapySignals[0] ?? null,
        type: entry.type,
        score: entry.score,
        published: entry.publishedIso ?? entry.published,
        evidenceLevel: entry.evidence.level
      }))
    : payload.overview.topDevelopments
  )
    .map(
      (item) => `
        <article class="spotlight-card spotlight-card--${escapeAttribute(item.type)}">
          <p class="spotlight-card__eyebrow">${escapeHtml(item.therapySignal ? `${getTherapyDisplayLabel(item.therapySignal)} • ${getTopicDisplayLabel(item.topic)}` : getTopicDisplayLabel(item.topic))} • ${escapeHtml(titleCase(item.evidenceLevel))}</p>
          <h3><a href="${escapeAttribute(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h3>
          <p>${escapeHtml(item.summary)}</p>
          <div class="spotlight-card__actions">
            <button
              class="spotlight-card__button"
              type="button"
              data-spotlight-topic="${escapeAttribute(item.topic)}"
              data-spotlight-therapy="${item.therapySignal ? escapeAttribute(item.therapySignal) : ""}"
              data-spotlight-type="${escapeAttribute(item.type)}"
            >
              Focus ${escapeHtml(item.therapySignal ? getTherapyDisplayLabel(item.therapySignal) : getTopicDisplayLabel(item.topic))}
            </button>
          </div>
          <div class="spotlight-card__meta">
            <span>${escapeHtml(item.source)}</span>
            <span>${escapeHtml(formatRelativeDateLabel(item.published))} • Score ${item.score}</span>
          </div>
        </article>
      `
    )
    .join("");
  if (!spotlightEl.innerHTML) {
    spotlightEl.innerHTML = `
      <article class="spotlight-card">
        <p class="spotlight-card__eyebrow">No spotlight</p>
        <h3>No entries match the current filters</h3>
        <p>Clear one or more filters to restore the full briefing overview.</p>
      </article>
    `;
  }
  presetsEl.innerHTML = payload.overview.savedPresetSuggestions
    .map(
      (preset) => `
        <button
          class="overview-preset"
          type="button"
          data-preset-id="${escapeAttribute(preset.id)}"
          aria-pressed="${String(preset.id === activePresetId)}"
        >
          ${escapeHtml(preset.therapy !== "all" ? `${preset.label} • ${getTherapyDisplayLabel(preset.therapy)}` : preset.label)}
        </button>
      `
    )
    .join("");
}

function populateSelect(
  selectEl: HTMLSelectElement,
  values: string[],
  defaultLabel: string,
  selectedValue: string
): void {
  selectEl.innerHTML = [`<option value="all">${escapeHtml(defaultLabel)}</option>`]
    .concat(values.map((value) => `<option value="${escapeAttribute(value)}">${escapeHtml(titleCase(value))}</option>`))
    .join("");
  selectEl.value = selectedValue;
}

function scrollToSection(sectionId: string): void {
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }

  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderActiveFilters(target: HTMLElement, filterState: FilterState, digest: DigestPayload | null): void {
  const chips: string[] = [];
  const activePreset = digest?.overview.savedPresetSuggestions.find((preset) => preset.id === filterState.activePresetId);

  if (activePreset) {
    chips.push(`
      <button class="active-filters__chip" type="button" data-filter-key="preset">
        <span>Preset: ${escapeHtml(activePreset.label)}</span>
        <span aria-hidden="true">Remove</span>
      </button>
    `);
  } else {
    if (filterState.topic !== "all") {
      chips.push(`
        <button class="active-filters__chip" type="button" data-filter-key="topic">
          <span>Topic: ${escapeHtml(titleCase(filterState.topic))}</span>
          <span aria-hidden="true">Remove</span>
        </button>
      `);
    }

    if (filterState.contentType !== "all") {
      chips.push(`
        <button class="active-filters__chip" type="button" data-filter-key="contentType">
          <span>Content: ${escapeHtml(titleCase(filterState.contentType))}</span>
          <span aria-hidden="true">Remove</span>
        </button>
      `);
    }

    if (filterState.audience !== "all") {
      chips.push(`
        <button class="active-filters__chip" type="button" data-filter-key="audience">
          <span>Audience: ${escapeHtml(titleCase(filterState.audience))}</span>
          <span aria-hidden="true">Remove</span>
        </button>
      `);
    }

    if (filterState.therapy !== "all") {
      chips.push(`
        <button class="active-filters__chip" type="button" data-filter-key="therapy">
          <span>Therapy: ${escapeHtml(getTherapyDisplayLabel(filterState.therapy))}</span>
          <span aria-hidden="true">Remove</span>
        </button>
      `);
    }
  }

  if (filterState.search) {
    chips.push(`
      <button class="active-filters__chip" type="button" data-filter-key="search">
        <span>Search: ${escapeHtml(filterState.search)}</span>
        <span aria-hidden="true">Remove</span>
      </button>
    `);
  }

  if (filterState.bookmarksOnly) {
    chips.push(`
      <button class="active-filters__chip" type="button" data-filter-key="bookmarksOnly">
        <span>Bookmarks only</span>
        <span aria-hidden="true">Remove</span>
      </button>
    `);
  }

  if (filterState.newOnly) {
    chips.push(`
      <button class="active-filters__chip" type="button" data-filter-key="newOnly">
        <span>New since last visit</span>
        <span aria-hidden="true">Remove</span>
      </button>
    `);
  }

  if (chips.length === 0) {
    target.classList.add("is-hidden");
    target.innerHTML = "";
    return;
  }

  target.classList.remove("is-hidden");
  target.innerHTML = chips.join("");
}

function getEmptyStateActions(filterState: FilterState): Array<{ key: string; label: string }> {
  const actions: Array<{ key: string; label: string }> = [];

  if (filterState.search) {
    actions.push({ key: "search", label: "Clear search" });
  }

  if (filterState.activePresetId) {
    actions.push({ key: "preset", label: "Remove preset" });
  } else {
    if (filterState.topic !== "all") {
      actions.push({ key: "topic", label: "Show all topics" });
    }

    if (filterState.contentType !== "all") {
      actions.push({ key: "contentType", label: "Show all content" });
    }

    if (filterState.audience !== "all") {
      actions.push({ key: "audience", label: "Show all audiences" });
    }

    if (filterState.therapy !== "all") {
      actions.push({ key: "therapy", label: "Show all therapies" });
    }
  }

  if (filterState.bookmarksOnly) {
    actions.push({ key: "bookmarksOnly", label: "Show all entries" });
  }

  if (filterState.newOnly) {
    actions.push({ key: "newOnly", label: "Include seen entries" });
  }

  if (actions.length > 1) {
    actions.push({ key: "resetAll", label: "Clear all filters" });
  }

  return actions.slice(0, 4);
}

function clearFilter(filterState: FilterState, filterKey: string): boolean {
  switch (filterKey) {
    case "preset":
    case "resetAll":
      filterState.search = "";
      filterState.topic = "all";
      filterState.contentType = "all";
      filterState.audience = "all";
      filterState.therapy = "all";
      filterState.bookmarksOnly = false;
      filterState.newOnly = false;
      filterState.activePresetId = "";
      return true;
    case "search":
      filterState.search = "";
      filterState.activePresetId = "";
      return true;
    case "topic":
      filterState.topic = "all";
      filterState.activePresetId = "";
      return true;
    case "contentType":
      filterState.contentType = "all";
      filterState.activePresetId = "";
      return true;
    case "audience":
      filterState.audience = "all";
      filterState.activePresetId = "";
      return true;
    case "therapy":
      filterState.therapy = "all";
      filterState.activePresetId = "";
      return true;
    case "bookmarksOnly":
      filterState.bookmarksOnly = false;
      filterState.activePresetId = "";
      return true;
    case "newOnly":
      filterState.newOnly = false;
      filterState.activePresetId = "";
      return true;
    default:
      return false;
  }
}

function renderSection(section: DigestSection, pageIndex: number, searchQuery: string): string {
  const pageCount = Math.max(1, Math.ceil(section.entries.length / SECTION_PAGE_SIZE));
  const safePageIndex = Math.min(Math.max(pageIndex, 0), pageCount - 1);
  const start = safePageIndex * SECTION_PAGE_SIZE;
  const visibleEntries = section.entries.slice(start, start + SECTION_PAGE_SIZE);
  const sectionBody =
    visibleEntries.length > 0
      ? `<div class="digest-section__grid">${renderEntries(visibleEntries, searchQuery)}</div>`
      : `
        <div class="empty-state">
          <p>No entries available yet for this section.</p>
          <p>The upstream sources may have returned no items during this request.</p>
        </div>
      `;

  const controls =
    pageCount > 1
      ? `
        <div class="digest-section__actions">
          <button class="pager-button" type="button" data-section-id="${escapeAttribute(section.id)}" data-direction="prev" ${safePageIndex === 0 ? "disabled" : ""}>
            Newer
          </button>
          <span class="pager-status">Page ${safePageIndex + 1} of ${pageCount}</span>
          <button class="pager-button" type="button" data-section-id="${escapeAttribute(section.id)}" data-direction="next" ${safePageIndex >= pageCount - 1 ? "disabled" : ""}>
            Older
          </button>
        </div>
      `
      : "";

  return `
    <section id="${escapeAttribute(section.id)}" class="digest-section">
      <div class="digest-section__header">
        <div>
          <p class="digest-section__eyebrow">Section</p>
          <h2>${escapeHtml(section.label)}</h2>
          <div class="digest-section__topics">${renderEntryTags(section.highlightedTopics, "digest-section__topic")}</div>
        </div>
        <div class="digest-section__summary">
          <p>${escapeHtml(section.description)}</p>
          <strong>${section.count} items</strong>
        </div>
      </div>
      ${sectionBody}
      ${controls}
    </section>
  `;
}

function renderSections(
  target: HTMLElement,
  sections: DigestSection[],
  pageIndexes: Map<string, number>,
  searchQuery: string,
  filterState: FilterState
): void {
  if (sections.length === 0) {
    const activeLabels: string[] = [];
    if (filterState.activePresetId) {
      activeLabels.push("preset");
    } else {
      if (filterState.topic !== "all") {
        activeLabels.push(`topic ${titleCase(filterState.topic)}`);
      }
      if (filterState.contentType !== "all") {
        activeLabels.push(`content ${titleCase(filterState.contentType)}`);
      }
      if (filterState.audience !== "all") {
        activeLabels.push(`audience ${titleCase(filterState.audience)}`);
      }
      if (filterState.therapy !== "all") {
        activeLabels.push(`therapy ${getTherapyDisplayLabel(filterState.therapy)}`);
      }
    }
    if (filterState.search) {
      activeLabels.push(`search "${filterState.search}"`);
    }
    if (filterState.bookmarksOnly) {
      activeLabels.push("bookmarks only");
    }
    if (filterState.newOnly) {
      activeLabels.push("new only");
    }

    const actionsMarkup = getEmptyStateActions(filterState)
      .map(
        (action) => `
          <button class="empty-state__action" type="button" data-filter-key="${escapeAttribute(action.key)}">
            ${escapeHtml(action.label)}
          </button>
        `
      )
      .join("");

    target.innerHTML = `
      <div class="empty-state empty-state--interactive">
        <p>No entries match the current filters.</p>
        <p>${escapeHtml(activeLabels.length > 0 ? `Current constraints: ${activeLabels.join(" • ")}.` : "Try widening topic, content, audience, therapy, or bookmark filters.")}</p>
        <div class="empty-state__actions">${actionsMarkup}</div>
      </div>
    `;
    return;
  }

  target.innerHTML = sections
    .map((section) => renderSection(section, pageIndexes.get(section.id) ?? 0, searchQuery))
    .join("");
}

function showError(target: HTMLElement, message: string): void {
  target.textContent = message;
  target.classList.remove("is-hidden");
}

function formatDiagnostic(diagnostic: DigestDiagnostic): string {
  const suffix = diagnostic.message ? `: ${diagnostic.message}` : "";
  return `[${diagnostic.kind}] ${diagnostic.label} -> ${diagnostic.status} (${diagnostic.itemCount})${suffix}`;
}

function showDiagnostics(target: HTMLElement, diagnostics: DigestDiagnostic[]): void {
  const problemDiagnostics = diagnostics.filter((diagnostic) => diagnostic.status !== "ok");

  if (problemDiagnostics.length === 0) {
    return;
  }

  target.textContent = `Diagnostics: ${problemDiagnostics.map(formatDiagnostic).join(" | ")}`;
  target.classList.remove("is-hidden");
}

function setupBackToTop(button: HTMLButtonElement): void {
  let ticking = false;

  const toggleVisibility = (): void => {
    const shouldShow = window.scrollY > 480;
    button.classList.toggle("is-hidden", !shouldShow);
    ticking = false;
  };

  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(toggleVisibility);
    },
    { passive: true }
  );
  toggleVisibility();
}

function applyTheme(theme: "light" | "dark", toggle: HTMLButtonElement): void {
  document.documentElement.dataset.theme = theme;
  toggle.setAttribute("aria-pressed", String(theme === "dark"));
  toggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function setupThemeToggle(button: HTMLButtonElement): void {
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(currentTheme, button);

  button.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme, button);
  });
}

function hideLoadingOverlay(overlay: HTMLElement): void {
  overlay.classList.add("loading-overlay--hidden");
  overlay.setAttribute("aria-busy", "false");
  overlay.setAttribute("aria-hidden", "true");
}

function getInitialDigestPayload(): DigestPayload | null {
  const element = document.getElementById("digest-initial-data");

  if (!(element instanceof HTMLScriptElement) || !element.textContent) {
    return null;
  }

  try {
    return JSON.parse(element.textContent) as DigestPayload;
  } catch (error) {
    console.error("Failed to parse embedded digest payload", error);
    return null;
  }
}

function filterSections(
  sections: DigestSection[],
  filterState: FilterState,
  bookmarks: Set<string>,
  seenEntries: Set<string>
): DigestSection[] {
  const hasSearch = Boolean(normalizeSearchText(filterState.search));
  const filteredSections = sections
    .map((section) => {
      const scoredEntries = section.entries
        .filter((entry) => matchesFilter(entry, filterState, bookmarks, seenEntries))
        .map((entry) => ({
          entry,
          searchScore: hasSearch ? getSearchScore(entry, filterState.search) : 0
        }))
        .sort((left, right) => {
          if (right.searchScore !== left.searchScore) {
            return right.searchScore - left.searchScore;
          }

          if (right.entry.score !== left.entry.score) {
            return right.entry.score - left.entry.score;
          }

          const rightPublished = Date.parse(right.entry.publishedIso ?? right.entry.published);
          const leftPublished = Date.parse(left.entry.publishedIso ?? left.entry.published);

          if (!Number.isNaN(rightPublished) && !Number.isNaN(leftPublished) && rightPublished !== leftPublished) {
            return rightPublished - leftPublished;
          }

          return left.entry.title.localeCompare(right.entry.title);
        });

      const filteredEntries = scoredEntries.map(({ entry }) => entry);
      const bestSearchScore = scoredEntries[0]?.searchScore ?? 0;
      const bestEntryScore = scoredEntries[0]?.entry.score ?? 0;

      return {
        ...section,
        count: filteredEntries.length,
        entries: filteredEntries,
        bestSearchScore,
        bestEntryScore
      };
    })
    .filter((section) => section.entries.length > 0);

  if (!hasSearch) {
    return filteredSections.map(({ bestSearchScore: _bestSearchScore, bestEntryScore: _bestEntryScore, ...section }) => section);
  }

  return filteredSections
    .sort((left, right) => {
      if (right.bestSearchScore !== left.bestSearchScore) {
        return right.bestSearchScore - left.bestSearchScore;
      }

      if (right.bestEntryScore !== left.bestEntryScore) {
        return right.bestEntryScore - left.bestEntryScore;
      }

      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label);
    })
    .map(({ bestSearchScore: _bestSearchScore, bestEntryScore: _bestEntryScore, ...section }) => section);
}

function applyDigestPayload(
  digest: DigestPayload,
  titleEl: HTMLElement,
  taglineEl: HTMLElement,
  updatedEl: HTMLElement,
  totalEl: HTMLElement,
  coverageEl: HTMLElement,
  dedupedEl: HTMLElement,
  overviewHealthEl: HTMLElement,
  overviewMetricsEl: HTMLElement,
  overviewSpotlightEl: HTMLElement,
  overviewPresetsEl: HTMLElement,
  navEl: HTMLElement,
  sectionsEl: HTMLElement,
  errorEl: HTMLElement,
  pageIndexes: Map<string, number>,
  filterState: FilterState,
  bookmarks: Set<string>,
  seenEntries: Set<string>
): DigestSection[] {
  const digestSections = filterSections(digest.sections, filterState, bookmarks, seenEntries);

  titleEl.textContent = digest.site.title;
  taglineEl.textContent = digest.site.tagline;
  updatedEl.textContent = formatGeneratedAt(digest.generatedAt, digest.generatedAtDisplay);
  totalEl.textContent = String(digest.totalEntries);
  coverageEl.textContent = `${digestSections.length} streams`;
  dedupedEl.textContent = String(digest.dedupedEntries);
  renderOverview(
    digest,
    digestSections,
    filterState,
    overviewHealthEl,
    overviewMetricsEl,
    overviewSpotlightEl,
    overviewPresetsEl,
    filterState.activePresetId
  );
  renderNav(navEl, digestSections);

  pageIndexes.clear();
  for (const section of digestSections) {
    pageIndexes.set(section.id, 0);
  }

  renderSections(sectionsEl, digestSections, pageIndexes, filterState.search, filterState);

  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.endsWith(".local");

  errorEl.classList.add("is-hidden");
  errorEl.textContent = "";

  if (isLocal) {
    showDiagnostics(errorEl, digest.diagnostics);
  }

  return digestSections;
}

async function fetchDigestPayload(endpoint: string): Promise<DigestPayload> {
  const candidates = [endpoint];

  if (endpoint === "/api/digest") {
    candidates.push("/.netlify/functions/digest");
  }

  let lastError: Error | null = null;

  for (const candidate of candidates) {
    const response = await fetch(candidate);

    if (response.ok) {
      return (await response.json()) as DigestPayload;
    }

    lastError = new Error(`Request failed with status ${response.status} for ${candidate}`);
  }

  throw lastError ?? new Error("Failed to load digest payload.");
}

export function initDigestPage(endpoint = "/api/digest"): void {
  if (!hasDigestPageElements()) {
    return;
  }

  const titleEl = getRequiredElement<HTMLElement>("digest-title");
  const taglineEl = getRequiredElement<HTMLElement>("digest-tagline");
  const updatedEl = getRequiredElement<HTMLElement>("digest-updated");
  const totalEl = getRequiredElement<HTMLElement>("digest-total");
  const coverageEl = getRequiredElement<HTMLElement>("digest-coverage");
  const dedupedEl = getRequiredElement<HTMLElement>("digest-deduped");
  const overviewHealthEl = getRequiredElement<HTMLElement>("overview-health");
  const overviewMetricsEl = getRequiredElement<HTMLElement>("overview-metrics");
  const overviewSpotlightEl = getRequiredElement<HTMLElement>("overview-spotlight");
  const overviewPresetsEl = getRequiredElement<HTMLElement>("overview-presets");
  const navEl = getRequiredElement<HTMLElement>("section-nav");
  const activeFiltersEl = getRequiredElement<HTMLElement>("active-filters");
  const sectionsEl = getRequiredElement<HTMLElement>("digest-sections");
  const errorEl = getRequiredElement<HTMLElement>("digest-error");
  const backToTopEl = getRequiredElement<HTMLButtonElement>("back-to-top");
  const loadingOverlayEl = getRequiredElement<HTMLElement>("loading-overlay");
  const themeToggleEl = getRequiredElement<HTMLButtonElement>("theme-toggle");
  const searchEl = getRequiredElement<HTMLInputElement>("digest-search");
  const searchAssistEl = getRequiredElement<HTMLElement>("search-assist");
  const topicFilterEl = getRequiredElement<HTMLSelectElement>("topic-filter");
  const contentFilterEl = getRequiredElement<HTMLSelectElement>("content-filter");
  const audienceFilterEl = getRequiredElement<HTMLSelectElement>("audience-filter");
  const therapyFilterEl = getRequiredElement<HTMLSelectElement>("therapy-filter");
  const presetFilterEl = getRequiredElement<HTMLSelectElement>("preset-filter");
  const bookmarksToggleEl = getRequiredElement<HTMLButtonElement>("bookmarks-toggle");
  const newToggleEl = getRequiredElement<HTMLButtonElement>("new-toggle");
  const clearFiltersEl = getRequiredElement<HTMLButtonElement>("clear-filters");
  const pageIndexes = new Map<string, number>();
  const filterState = getInitialFilterState();
  const bookmarkIds = new Set(getBookmarks());
  const seenEntries = new Set(getSeenEntries());
  let activePayload = getInitialDigestPayload();
  let digestSections = getInitialDigestPayload()?.sections ?? [];

  setupBackToTop(backToTopEl);
  setupThemeToggle(themeToggleEl);

  const renderActivePayload = (): void => {
    if (!activePayload) {
      return;
    }

    digestSections = applyDigestPayload(
      activePayload,
      titleEl,
      taglineEl,
      updatedEl,
      totalEl,
      coverageEl,
      dedupedEl,
      overviewHealthEl,
      overviewMetricsEl,
      overviewSpotlightEl,
      overviewPresetsEl,
      navEl,
      sectionsEl,
      errorEl,
      pageIndexes,
      filterState,
      bookmarkIds,
      seenEntries
    );
    renderActiveFilters(activeFiltersEl, filterState, activePayload);

    const bookmarkButtons = Array.from(sectionsEl.querySelectorAll<HTMLButtonElement>(".entry-card__bookmark"));
    for (const button of bookmarkButtons) {
      const entryId = button.dataset.entryId;
      const bookmarked = entryId ? bookmarkIds.has(entryId) : false;
      button.setAttribute("aria-pressed", String(bookmarked));
      button.textContent = bookmarked ? "Saved" : "Save";
    }
  };

  const syncControls = (): void => {
    if (!activePayload) {
      return;
    }

    const allEntries = activePayload.sections.flatMap((section) => section.entries);
    const topics = Array.from(new Set(allEntries.flatMap((entry) => entry.topics).filter((topic) => topic !== "general")));
    const contentTypes = Array.from(new Set(allEntries.flatMap((entry) => entry.contentTypes)));
    const audiences = Array.from(new Set(allEntries.flatMap((entry) => entry.audiences)));
    const therapies = Array.from(new Set(allEntries.flatMap((entry) => entry.therapySignals)));

    searchEl.value = filterState.search;
    renderSearchAssist(searchAssistEl, filterState);
    populateSelect(topicFilterEl, topics, "All topics", filterState.topic);
    populateSelect(contentFilterEl, contentTypes, "All content", filterState.contentType);
    populateSelect(audienceFilterEl, audiences, "All audiences", filterState.audience);
    therapyFilterEl.innerHTML = ['<option value="all">All therapies</option>']
      .concat(
        therapies.map((therapy) => `<option value="${escapeAttribute(therapy)}">${escapeHtml(getTherapyDisplayLabel(therapy))}</option>`)
      )
      .join("");
    therapyFilterEl.value = filterState.therapy;
    presetFilterEl.innerHTML = ['<option value="">Choose preset</option>']
      .concat(
        activePayload.overview.savedPresetSuggestions.map(
          (preset) =>
            `<option value="${escapeAttribute(preset.id)}">${escapeHtml(
              preset.therapy !== "all" ? `${preset.label} • ${getTherapyDisplayLabel(preset.therapy)}` : preset.label
            )}</option>`
        )
      )
      .join("");
    presetFilterEl.value = filterState.activePresetId;
    bookmarksToggleEl.setAttribute("aria-pressed", String(filterState.bookmarksOnly));
    newToggleEl.setAttribute("aria-pressed", String(filterState.newOnly));
  };

  const resetFilters = (): void => {
    filterState.search = "";
    filterState.topic = "all";
    filterState.contentType = "all";
    filterState.audience = "all";
    filterState.therapy = "all";
    filterState.bookmarksOnly = false;
    filterState.newOnly = false;
    filterState.activePresetId = "";
  };

  const applyPresetById = (presetId: string): void => {
    if (!activePayload) {
      return;
    }

    const preset = activePayload.overview.savedPresetSuggestions.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    filterState.topic = preset.topic;
    filterState.contentType = preset.contentType;
    filterState.audience = preset.audience;
    filterState.therapy = preset.therapy;
    filterState.search = "";
    filterState.activePresetId = preset.id;
    syncControls();
    persistFilters();
    renderActivePayload();
  };

  const focusSpotlight = (topic: TopicTag | "all", therapy: TherapyTag | "all", type: string): void => {
    filterState.topic = topic;
    filterState.therapy = therapy;
    filterState.contentType = "all";
    filterState.audience = "all";
    filterState.search = "";
    filterState.activePresetId = "";
    persistFilters();
    syncControls();
    renderActivePayload();
    scrollToSection(type);
  };

  const initialDigest = getInitialDigestPayload();
  if (initialDigest) {
    activePayload = initialDigest;
    syncControls();
    renderActivePayload();
    markSeenEntries(initialDigest.sections);
    hideLoadingOverlay(loadingOverlayEl);
  }

  const persistFilters = (): void => {
    writeJsonStorage(FILTER_STORAGE_KEY, filterState);
  };

  overviewPresetsEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>(".overview-preset");
    if (!button?.dataset.presetId) {
      return;
    }

    applyPresetById(button.dataset.presetId);
  });

  overviewSpotlightEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>(".spotlight-card__button");
    const topic = button?.dataset.spotlightTopic as TopicTag | undefined;
    const therapy = (button?.dataset.spotlightTherapy as TherapyTag | undefined) ?? "all";
    const type = button?.dataset.spotlightType;

    if (!button || !topic || !type) {
      return;
    }

    focusSpotlight(topic, therapy, type);
  });

  searchEl.addEventListener("input", () => {
    filterState.search = searchEl.value.trim();
    filterState.activePresetId = "";
    persistFilters();
    renderActivePayload();
  });

  searchAssistEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>(".search-assist__chip");
    if (!button) {
      return;
    }

    if (button.dataset.searchQuery) {
      filterState.search = button.dataset.searchQuery;
      filterState.activePresetId = "";
    }

    if (button.dataset.topicValue) {
      filterState.topic = button.dataset.topicValue as TopicTag | "all";
      filterState.activePresetId = "";
    }

    if (button.dataset.therapyValue) {
      filterState.therapy = button.dataset.therapyValue as TherapyTag | "all";
      filterState.activePresetId = "";
    }

    syncControls();
    persistFilters();
    renderActivePayload();
  });

  topicFilterEl.addEventListener("change", () => {
    filterState.topic = topicFilterEl.value as TopicTag | "all";
    filterState.activePresetId = "";
    persistFilters();
    renderActivePayload();
  });

  contentFilterEl.addEventListener("change", () => {
    filterState.contentType = contentFilterEl.value as ContentTag | "all";
    filterState.activePresetId = "";
    persistFilters();
    renderActivePayload();
  });

  audienceFilterEl.addEventListener("change", () => {
    filterState.audience = audienceFilterEl.value as AudienceTag | "all";
    filterState.activePresetId = "";
    persistFilters();
    renderActivePayload();
  });

  therapyFilterEl.addEventListener("change", () => {
    filterState.therapy = therapyFilterEl.value as TherapyTag | "all";
    filterState.activePresetId = "";
    persistFilters();
    renderActivePayload();
  });

  presetFilterEl.addEventListener("change", () => {
    if (!activePayload || !presetFilterEl.value) {
      return;
    }

    applyPresetById(presetFilterEl.value);
  });

  bookmarksToggleEl.addEventListener("click", () => {
    filterState.bookmarksOnly = !filterState.bookmarksOnly;
    filterState.activePresetId = "";
    persistFilters();
    syncControls();
    renderActivePayload();
  });

  newToggleEl.addEventListener("click", () => {
    filterState.newOnly = !filterState.newOnly;
    filterState.activePresetId = "";
    persistFilters();
    syncControls();
    renderActivePayload();
  });

  clearFiltersEl.addEventListener("click", () => {
    resetFilters();
    syncControls();
    persistFilters();
    renderActivePayload();
  });

  activeFiltersEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const chip = target.closest<HTMLButtonElement>(".active-filters__chip");
    const filterKey = chip?.dataset.filterKey;

    if (!chip || !filterKey) {
      return;
    }

    if (!clearFilter(filterState, filterKey)) {
      return;
    }

    syncControls();
    persistFilters();
    renderActivePayload();
  });

  sectionsEl.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const emptyStateButton = target.closest<HTMLButtonElement>(".empty-state__action");
    if (emptyStateButton?.dataset.filterKey) {
      if (!clearFilter(filterState, emptyStateButton.dataset.filterKey)) {
        return;
      }

      syncControls();
      persistFilters();
      renderActivePayload();
      return;
    }

    const bookmarkButton = target.closest<HTMLButtonElement>(".entry-card__bookmark");
    if (bookmarkButton) {
      const entryId = bookmarkButton.dataset.entryId;
      if (!entryId) {
        return;
      }

      if (bookmarkIds.has(entryId)) {
        bookmarkIds.delete(entryId);
      } else {
        bookmarkIds.add(entryId);
      }

      writeJsonStorage(BOOKMARK_STORAGE_KEY, Array.from(bookmarkIds));
      renderActivePayload();
      return;
    }

    const button = target.closest<HTMLButtonElement>(".pager-button");

    if (!button || button.disabled) {
      return;
    }

    const sectionId = button.dataset.sectionId;
    const direction = button.dataset.direction;
    const section = digestSections.find((item) => item.id === sectionId);

    if (!section || !sectionId || (direction !== "next" && direction !== "prev")) {
      return;
    }

    const currentPage = pageIndexes.get(sectionId) ?? 0;
    const pageCount = Math.max(1, Math.ceil(section.entries.length / SECTION_PAGE_SIZE));
    const nextPage =
      direction === "next"
        ? Math.min(pageCount - 1, currentPage + 1)
        : Math.max(0, currentPage - 1);

    if (nextPage === currentPage) {
      return;
    }

    pageIndexes.set(sectionId, nextPage);

    const currentSectionEl = sectionsEl.querySelector<HTMLElement>(`#${CSS.escape(sectionId)}`);
    if (!currentSectionEl) {
      return;
    }

    currentSectionEl.outerHTML = renderSection(section, nextPage);
  });

  fetchDigestPayload(endpoint)
    .then((digest) => {
      activePayload = digest;
      syncControls();
      renderActivePayload();
      markSeenEntries(digest.sections);
      hideLoadingOverlay(loadingOverlayEl);
    })
    .catch((error) => {
      console.error("Failed to load digest", error);

      if (digestSections.length === 0) {
        showError(errorEl, "Failed to load digest data from the backend API.");
        navEl.innerHTML = '<span class="section-nav__link">Digest unavailable</span>';
      }

      hideLoadingOverlay(loadingOverlayEl);
    });
}
