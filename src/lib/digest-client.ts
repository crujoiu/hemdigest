import type { DigestDiagnostic, DigestEntry, DigestPayload, DigestSection } from "./digest-types";

const SECTION_PAGE_SIZE = 12;
const THEME_STORAGE_KEY = "theme";
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
    "section-nav",
    "digest-sections",
    "digest-error",
    "back-to-top",
    "loading-overlay",
    "theme-toggle"
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

function renderEntries(entries: DigestEntry[]): string {
  return entries
    .map(
      (entry) => `
        <article class="entry-card entry-card--${escapeAttribute(entry.type)}">
          <div class="entry-card__topline">
            <span class="entry-card__badge entry-card__badge--${escapeAttribute(entry.type)}">${escapeHtml(entry.type)}</span>
            <p class="entry-card__source">${escapeHtml(entry.source)}</p>
          </div>

          <h3 class="entry-card__title">
            <a href="${escapeAttribute(entry.link)}" target="_blank" rel="noreferrer">${escapeHtml(entry.title)}</a>
          </h3>

          <p class="entry-card__summary">${escapeHtml(entry.summary)}</p>

          <div class="entry-card__meta">
            <span>Published</span>
            <time datetime="${entry.publishedIso ? escapeAttribute(entry.publishedIso) : ""}">${escapeHtml(formatEntryDate(entry))}</time>
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

function applyDigestPayload(
  digest: DigestPayload,
  titleEl: HTMLElement,
  taglineEl: HTMLElement,
  updatedEl: HTMLElement,
  totalEl: HTMLElement,
  coverageEl: HTMLElement,
  navEl: HTMLElement,
  sectionsEl: HTMLElement,
  errorEl: HTMLElement,
  pageIndexes: Map<string, number>
): DigestSection[] {
  const digestSections = digest.sections;

  titleEl.textContent = digest.site.title;
  taglineEl.textContent = digest.site.tagline;
  updatedEl.textContent = formatGeneratedAt(digest.generatedAt, digest.generatedAtDisplay);
  totalEl.textContent = String(digest.totalEntries);
  coverageEl.textContent = `${digestSections.length} streams`;
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
  const navEl = getRequiredElement<HTMLElement>("section-nav");
  const sectionsEl = getRequiredElement<HTMLElement>("digest-sections");
  const errorEl = getRequiredElement<HTMLElement>("digest-error");
  const backToTopEl = getRequiredElement<HTMLButtonElement>("back-to-top");
  const loadingOverlayEl = getRequiredElement<HTMLElement>("loading-overlay");
  const themeToggleEl = getRequiredElement<HTMLButtonElement>("theme-toggle");
  const pageIndexes = new Map<string, number>();
  let digestSections = getInitialDigestPayload()?.sections ?? [];

  setupBackToTop(backToTopEl);
  setupThemeToggle(themeToggleEl);

  const initialDigest = getInitialDigestPayload();
  if (initialDigest) {
    digestSections = applyDigestPayload(
      initialDigest,
      titleEl,
      taglineEl,
      updatedEl,
      totalEl,
      coverageEl,
      navEl,
      sectionsEl,
      errorEl,
      pageIndexes
    );
    hideLoadingOverlay(loadingOverlayEl);
  }

  sectionsEl.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
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
      digestSections = applyDigestPayload(
        digest,
        titleEl,
        taglineEl,
        updatedEl,
        totalEl,
        coverageEl,
        navEl,
        sectionsEl,
        errorEl,
        pageIndexes
      );
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
