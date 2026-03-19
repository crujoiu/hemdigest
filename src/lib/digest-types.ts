export type EntryType = "pubmed" | "journal" | "news";

export interface DigestEntry {
  title: string;
  link: string;
  summary: string;
  published: string;
  publishedIso: string | null;
  source: string;
  type: EntryType;
}

export interface DigestSection {
  id: EntryType;
  label: string;
  description: string;
  count: number;
  entries: DigestEntry[];
}

export interface DigestDiagnostic {
  kind: "feed" | "pubmed";
  id: string;
  label: string;
  status: "ok" | "empty" | "error";
  itemCount: number;
  message?: string;
}

export interface DigestPayload {
  site: {
    title: string;
    tagline: string;
    description: string;
  };
  generatedAt: string;
  generatedAtDisplay: string;
  totalEntries: number;
  sources: string[];
  sections: DigestSection[];
  diagnostics: DigestDiagnostic[];
}
