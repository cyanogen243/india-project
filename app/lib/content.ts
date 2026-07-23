import updatesData from "@/content/updates.json";
import demandsData from "@/content/demands.json";
import timelineData from "@/content/timeline.json";
import correctionsData from "@/content/corrections.json";
import readingRoomData from "@/content/reading-room.json";
import mediaData from "@/content/media.json";
import governmentResponsesData from "@/content/government-responses.json";

export type Language = "en" | "hi";
export type UpdateStatus =
  | "reported"
  | "corroborating"
  | "verified"
  | "disputed"
  | "retracted";

export type SourceRef = {
  label: string;
  url?: string;
  tier: "A" | "B" | "C" | "D" | "E";
  archivedCopy?: string;
  accessedAt: string;
};

export type Update = {
  id: string;
  language: Language;
  title: string;
  summary: string;
  city: string;
  zone: string;
  eventTime: string;
  publishedAt: string;
  expiresAt?: string;
  status: UpdateStatus;
  sensitivity: "low" | "medium" | "high";
  sources: SourceRef[];
  reviewers: string[];
  correctionIds?: string[];
};

export type Demand = {
  id: string;
  language: Language;
  text: string;
  approvedBy: string;
  approvedAt: string;
  version: string;
  sources: SourceRef[];
};

export type TimelineItem = {
  id: string;
  language: Language;
  date: string;
  title: string;
  summary: string;
  status: "verified" | "disputed" | "corrected";
  sources: SourceRef[];
};

export type ReadingItem = {
  id: string;
  language: Language;
  title: string;
  kind: string;
  summary: string;
  href: string;
};

export type GovernmentResponse = {
  id: string;
  language: Language;
  authority: string;
  title: string;
  summary: string;
  issuedAt: string;
  source: SourceRef;
  relatedDemandIds?: string[];
};

export type Correction = {
  id: string;
  language: Language;
  targetType: "update" | "timeline" | "demand" | "guide";
  targetId: string;
  originalText: string;
  correctedText: string;
  reason: string;
  correctedAt: string;
  approvedBy: string[];
};

export type MediaRecord = {
  id: string;
  language: Language;
  title: string;
  summary: string;
  file: string;
  poster?: string;
  date: string;
  broadZone: string;
  status: "verified" | "disputed" | "retracted";
  redaction: string;
  legalReview: string;
  sources: SourceRef[];
  reviewers: string[];
};

export const updates = updatesData as Update[];
export const demands = demandsData as Demand[];
export const timeline = timelineData as TimelineItem[];
export const corrections = correctionsData as Correction[];
export const readingRoom = readingRoomData as ReadingItem[];
export const media = mediaData as MediaRecord[];
export const governmentResponses =
  governmentResponsesData as GovernmentResponse[];

export function forLanguage<T extends { language: Language }>(
  records: T[],
  language: Language,
) {
  return records.filter((record) => record.language === language);
}

export function formatDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function isStale(update: Update) {
  return update.expiresAt ? new Date(update.expiresAt).getTime() < Date.now() : false;
}
