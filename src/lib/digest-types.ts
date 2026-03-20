export type EntryType = "pubmed" | "journal" | "news";
export type TopicTag =
  | "aml"
  | "all"
  | "lymphoma"
  | "myeloma"
  | "mpn"
  | "anemia"
  | "thrombosis"
  | "transplant"
  | "benign"
  | "general";
export type ContentTag = "trial" | "review" | "guideline" | "approval" | "conference" | "news-update" | "research";
export type AudienceTag = "clinicians" | "researchers" | "industry" | "patients";
export type EvidenceLevel = "guideline" | "phase-3" | "phase-2" | "observational" | "review" | "news";

export interface EvidenceSnapshot {
  level: EvidenceLevel;
  studyType: string;
  phase: string | null;
  sampleSize: number | null;
  rationale: string;
}

export interface EntryWhyItMatters {
  summary: string;
  matchedSignals: string[];
}

export interface DigestEntry {
  id: string;
  title: string;
  link: string;
  summary: string;
  published: string;
  publishedIso: string | null;
  source: string;
  type: EntryType;
  topics: TopicTag[];
  contentTypes: ContentTag[];
  audiences: AudienceTag[];
  evidence: EvidenceSnapshot;
  score: number;
  dedupeKey: string;
  isPrimarySource: boolean;
  whyItMatters: EntryWhyItMatters;
  transparency: {
    matchedBecause: string[];
    sourceType: string;
    ingestedAt: string;
  };
}

export interface DigestSection {
  id: EntryType;
  label: string;
  description: string;
  count: number;
  highlightedTopics: TopicTag[];
  entries: DigestEntry[];
}

export interface DigestTopDevelopment {
  id: string;
  title: string;
  summary: string;
  source: string;
  link: string;
  topic: TopicTag;
  type: EntryType;
  score: number;
  published: string;
  evidenceLevel: EvidenceLevel;
}

export interface DigestTopicActivity {
  topic: TopicTag;
  label: string;
  count: number;
}

export interface DigestFeedHealth {
  totalSources: number;
  healthySources: number;
  degradedSources: number;
}

export interface DigestOverview {
  topDevelopments: DigestTopDevelopment[];
  topicActivity: DigestTopicActivity[];
  sourceHealth: DigestFeedHealth;
  savedPresetSuggestions: Array<{
    id: string;
    label: string;
    topic: TopicTag | "all";
    contentType: ContentTag | "all";
    audience: AudienceTag | "all";
  }>;
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
  dedupedEntries: number;
  sources: string[];
  overview: DigestOverview;
  sections: DigestSection[];
  diagnostics: DigestDiagnostic[];
}
