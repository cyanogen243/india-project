import { z } from "zod";

const unsafeText = new RegExp(
  ["<script", "javascript:", "on\\w+\\s*=", "<" + "iframe", "data:text/html"].join("|"),
  "i",
);
const forbiddenKeys = new Set([
  "coordinates",
  "latitude",
  "longitude",
  "exactLocation",
  "preciseAddress",
]);

function scan(value: unknown, path = "record") {
  if (typeof value === "string" && unsafeText.test(value)) {
    throw new Error(`${path}: unsafe HTML or JavaScript`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) {
        throw new Error(`${path}: precise-location field ${key} is not allowed`);
      }
      scan(child, `${path}.${key}`);
    }
  }
}

const source = z.object({
  label: z.string().min(2).max(240),
  url: z.string().url().optional(),
  tier: z.enum(["A", "B", "C", "D", "E"]),
  archivedCopy: z.string().url().optional(),
  accessedAt: z.string().datetime({ offset: true }),
});

const schemas: Record<string, z.ZodTypeAny> = {
  updates: z.object({
    id: z.string().min(2),
    language: z.enum(["en", "hi"]),
    title: z.string().min(4).max(240),
    summary: z.string().min(10).max(3000),
    city: z.string().min(2).max(120),
    zone: z.string().min(2).max(160),
    eventTime: z.string().datetime({ offset: true }),
    publishedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    status: z.enum(["reported", "corroborating", "verified", "disputed", "retracted"]),
    sensitivity: z.enum(["low", "medium", "high"]),
    sources: z.array(source).min(1),
    reviewers: z.array(z.string().min(1)).min(1),
    correctionIds: z.array(z.string()).optional(),
  }),
  demands: z.object({
    id: z.string().min(2),
    language: z.enum(["en", "hi"]),
    text: z.string().min(4),
    approvedBy: z.string().min(2),
    approvedAt: z.string().datetime({ offset: true }),
    version: z.string().min(1),
    sources: z.array(source).min(1),
  }),
  "government-responses": z.object({
    id: z.string().min(2),
    language: z.enum(["en", "hi"]),
    authority: z.string().min(2),
    title: z.string().min(4),
    summary: z.string().min(10),
    issuedAt: z.string().datetime({ offset: true }),
    source,
    relatedDemandIds: z.array(z.string()).optional(),
  }),
  timeline: z.object({
    id: z.string().min(2),
    language: z.enum(["en", "hi"]),
    date: z.string().datetime({ offset: true }),
    title: z.string().min(4),
    summary: z.string().min(10),
    status: z.enum(["verified", "disputed", "corrected"]),
    sources: z.array(source).min(1),
  }),
  corrections: z.object({
    id: z.string().min(2),
    language: z.enum(["en", "hi"]),
    targetType: z.enum(["update", "timeline", "demand", "guide"]),
    targetId: z.string().min(2),
    originalText: z.string().min(1),
    correctedText: z.string().min(1),
    reason: z.string().min(2),
    correctedAt: z.string().datetime({ offset: true }),
    approvedBy: z.array(z.string().min(1)).min(1),
  }),
  "reading-room": z.object({
    id: z.string().min(2),
    language: z.enum(["en", "hi"]),
    title: z.string().min(2),
    kind: z.string().min(2),
    summary: z.string().min(4),
    href: z.string().url(),
  }),
  resources: z.object({
    id: z.string().min(2),
    language: z.enum(["en", "hi"]),
    title: z.string().min(2),
    owner: z.string().min(2),
    category: z.string().min(2),
    summary: z.string().min(4),
    href: z.string().url(),
    reliability: z.enum(["official", "established", "community"]),
    reviewedAt: z.string().date(),
  }),
  landing: z.object({
    id: z.string().min(2),
    language: z.enum(["en", "hi"]),
    title: z.string().min(2),
    body: z.string().min(10),
  }),
};

export const editableCollections = Object.keys(schemas);

export function validateContentRecord(collection: string, input: unknown) {
  const schema = schemas[collection];
  if (!schema) throw new Error(`Unknown content collection: ${collection}`);
  scan(input);
  const value = schema.parse(input) as Record<string, unknown>;
  if (collection === "updates") {
    const update = value as {
      status: string;
      sensitivity: string;
      sources: { tier: string }[];
      reviewers: string[];
    };
    if (update.sensitivity === "high" && update.reviewers.length < 2) {
      throw new Error("High-sensitivity updates require two reviewers");
    }
    if (
      update.status === "verified" &&
      !update.sources.some((item) => ["A", "B", "C"].includes(item.tier))
    ) {
      throw new Error("Verified updates require a tier A, B, or C source");
    }
  }
  return value;
}

export function validateCollectionParity(
  collection: string,
  records: Record<string, unknown>[],
) {
  if (collection !== "updates") return;
  const en = records
    .filter((item) => item.language === "en")
    .map((item) => item.id)
    .sort();
  const hi = records
    .filter((item) => item.language === "hi")
    .map((item) => item.id)
    .sort();
  if (JSON.stringify(en) !== JSON.stringify(hi)) {
    throw new Error("Updates must have matching English and Hindi record IDs");
  }
}
