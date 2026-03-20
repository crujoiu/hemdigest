import type { AudienceTag, ContentTag, DigestDiagnostic, DigestEntry, DigestPayload, DigestSection, TopicTag } from "./digest-types";

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
    "preset-filter",
    "bookmarks-toggle",
    "new-toggle",
    "clear-filters"
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

function renderEntries(entries: DigestEntry[]): string {
  return entries
    .map(
      (entry) => `
        <article class="entry-card entry-card--${escapeAttribute(entry.type)}">
          <div class="entry-card__topline">
            <div class="entry-card__badges">
              <span class="entry-card__badge entry-card__badge--${escapeAttribute(entry.type)}">${escapeHtml(entry.type)}</span>
              <span class="entry-card__evidence">${escapeHtml(titleCase(entry.evidence.level))}</span>
              ${renderEntryTags(entry.topics.filter((topic) => topic !== "general"), "entry-card__tag")}
            </div>
            <button class="entry-card__bookmark" type="button" data-entry-id="${escapeAttribute(entry.id)}" aria-pressed="false">
              Save
            </button>
          </div>
          <div class="entry-card__source-row">
            <p class="entry-card__source">${escapeHtml(entry.source)}</p>
            <p class="entry-card__score">Score ${entry.score}</p>
          </div>

          <h3 class="entry-card__title">
            <a href="${escapeAttribute(entry.link)}" target="_blank" rel="noreferrer">${escapeHtml(entry.title)}</a>
          </h3>

          <p class="entry-card__summary">${escapeHtml(entry.summary)}</p>
          <p class="entry-card__why">${escapeHtml(entry.whyItMatters.summary)}</p>
          <div class="entry-card__taxonomy">
            ${renderEntryTags(entry.contentTypes, "entry-card__taxonomy-tag")}
            ${renderEntryTags(entry.audiences, "entry-card__taxonomy-tag")}
          </div>

          <div class="entry-card__meta">
            <span>${escapeHtml(entry.evidence.studyType)}${entry.evidence.phase ? ` • ${escapeHtml(entry.evidence.phase)}` : ""}</span>
            <time datetime="${entry.publishedIso ? escapeAttribute(entry.publishedIso) : ""}">${escapeHtml(formatEntryDate(entry))}</time>
          </div>
          <p class="entry-card__evidence-note">${escapeHtml(entry.evidence.rationale)}</p>
          <div class="entry-card__transparency">
            <span>${escapeHtml(entry.transparency.matchedBecause.join(" • ") || "Matched by source and text signals")}</span>
            <span>${escapeHtml(titleCase(entry.transparency.sourceType))} source • Ingested ${escapeHtml(formatRelativeDateLabel(entry.transparency.ingestedAt))}</span>
          </div>
        </article>
      `
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
  return readJsonStorage<FilterState>(FILTER_STORAGE_KEY, {
    search: "",
    topic: "all",
    contentType: "all",
    audience: "all",
    bookmarksOnly: false,
    newOnly: false,
    activePresetId: ""
  });
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

function matchesFilter(entry: DigestEntry, filterState: FilterState, bookmarks: Set<string>, seenEntries: Set<string>): boolean {
  const haystack = `${entry.title} ${entry.summary} ${entry.source} ${entry.topics.join(" ")} ${entry.contentTypes.join(" ")}`.toLowerCase();

  if (filterState.search && !haystack.includes(filterState.search.toLowerCase())) {
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
  healthEl: HTMLElement,
  metricsEl: HTMLElement,
  spotlightEl: HTMLElement,
  presetsEl: HTMLElement,
  activePresetId: string
): void {
  const healthy = payload.overview.sourceHealth.healthySources;
  const total = payload.overview.sourceHealth.totalSources;
  const topicActivity = payload.overview.topicActivity.slice(0, 3).map((item) => `${item.label} ${item.count}`).join(" • ");

  healthEl.textContent = `${healthy}/${total} source pipelines healthy. ${topicActivity || "Topic activity will appear as feeds populate."}`;
  metricsEl.innerHTML = [
    `<article class="overview-card"><p class="overview-card__label">Top developments</p><strong>${payload.overview.topDevelopments.length}</strong></article>`,
    `<article class="overview-card"><p class="overview-card__label">Duplicates removed</p><strong>${payload.dedupedEntries}</strong></article>`,
    `<article class="overview-card"><p class="overview-card__label">Active topics</p><strong>${payload.overview.topicActivity.length}</strong></article>`
  ].join("");
  spotlightEl.innerHTML = payload.overview.topDevelopments
    .map(
      (item) => `
        <article class="spotlight-card spotlight-card--${escapeAttribute(item.type)}">
          <p class="spotlight-card__eyebrow">${escapeHtml(titleCase(item.topic))} • ${escapeHtml(titleCase(item.evidenceLevel))}</p>
          <h3><a href="${escapeAttribute(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h3>
          <p>${escapeHtml(item.summary)}</p>
          <div class="spotlight-card__actions">
            <button
              class="spotlight-card__button"
              type="button"
              data-spotlight-topic="${escapeAttribute(item.topic)}"
              data-spotlight-type="${escapeAttribute(item.type)}"
            >
              Focus ${escapeHtml(titleCase(item.topic))}
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
  presetsEl.innerHTML = payload.overview.savedPresetSuggestions
    .map(
      (preset) => `
        <button
          class="overview-preset"
          type="button"
          data-preset-id="${escapeAttribute(preset.id)}"
          aria-pressed="${String(preset.id === activePresetId)}"
        >
          ${escapeHtml(preset.label)}
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

function renderSection(section: DigestSection, pageIndex: number): string {
  const pageCount = Math.max(1, Math.ceil(section.entries.length / SECTION_PAGE_SIZE));
  const safePageIndex = Math.min(Math.max(pageIndex, 0), pageCount - 1);
  const start = safePageIndex * SECTION_PAGE_SIZE;
  const visibleEntries = section.entries.slice(start, start + SECTION_PAGE_SIZE);
  const sectionBody =
    visibleEntries.length > 0
      ? `<div class="digest-section__grid">${renderEntries(visibleEntries)}</div>`
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

function renderSections(target: HTMLElement, sections: DigestSection[], pageIndexes: Map<string, number>): void {
  if (sections.length === 0) {
    target.innerHTML = `
      <div class="empty-state">
        <p>No entries match the current filters.</p>
        <p>Try widening topic, content, audience, or bookmark filters.</p>
      </div>
    `;
    return;
  }

  target.innerHTML = sections
    .map((section) => renderSection(section, pageIndexes.get(section.id) ?? 0))
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
  return sections
    .map((section) => {
      const filteredEntries = section.entries.filter((entry) => matchesFilter(entry, filterState, bookmarks, seenEntries));
      return {
        ...section,
        count: filteredEntries.length,
        entries: filteredEntries
      };
    })
    .filter((section) => section.entries.length > 0);
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
  renderOverview(digest, overviewHealthEl, overviewMetricsEl, overviewSpotlightEl, overviewPresetsEl, filterState.activePresetId);
  renderNav(navEl, digestSections);

  pageIndexes.clear();
  for (const section of digestSections) {
    pageIndexes.set(section.id, 0);
  }

  renderSections(sectionsEl, digestSections, pageIndexes);

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
  const sectionsEl = getRequiredElement<HTMLElement>("digest-sections");
  const errorEl = getRequiredElement<HTMLElement>("digest-error");
  const backToTopEl = getRequiredElement<HTMLButtonElement>("back-to-top");
  const loadingOverlayEl = getRequiredElement<HTMLElement>("loading-overlay");
  const themeToggleEl = getRequiredElement<HTMLButtonElement>("theme-toggle");
  const searchEl = getRequiredElement<HTMLInputElement>("digest-search");
  const topicFilterEl = getRequiredElement<HTMLSelectElement>("topic-filter");
  const contentFilterEl = getRequiredElement<HTMLSelectElement>("content-filter");
  const audienceFilterEl = getRequiredElement<HTMLSelectElement>("audience-filter");
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

    searchEl.value = filterState.search;
    populateSelect(topicFilterEl, topics, "All topics", filterState.topic);
    populateSelect(contentFilterEl, contentTypes, "All content", filterState.contentType);
    populateSelect(audienceFilterEl, audiences, "All audiences", filterState.audience);
    presetFilterEl.innerHTML = ['<option value="">Choose preset</option>']
      .concat(
        activePayload.overview.savedPresetSuggestions.map(
          (preset) => `<option value="${escapeAttribute(preset.id)}">${escapeHtml(preset.label)}</option>`
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
    filterState.search = "";
    filterState.activePresetId = preset.id;
    syncControls();
    persistFilters();
    renderActivePayload();
  };

  const focusSpotlight = (topic: TopicTag | "all", type: string): void => {
    filterState.topic = topic;
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
    const type = button?.dataset.spotlightType;

    if (!button || !topic || !type) {
      return;
    }

    focusSpotlight(topic, type);
  });

  searchEl.addEventListener("input", () => {
    filterState.search = searchEl.value.trim();
    filterState.activePresetId = "";
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

  sectionsEl.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
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
