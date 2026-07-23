import { readFile } from "node:fs/promises";

const contentFiles = [
  "content/updates.json",
  "content/demands.json",
  "content/government-responses.json",
  "content/timeline.json",
  "content/corrections.json",
  "content/reading-room.json",
  "content/media.json",
];

const unsafeText = /<script|javascript:|on\w+\s*=|<iframe|data:text\/html/i;
const forbiddenLocationKeys = new Set([
  "coordinates",
  "latitude",
  "longitude",
  "exactLocation",
  "preciseAddress",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function scan(value, path = "record") {
  if (typeof value === "string") {
    assert(!unsafeText.test(value), `${path}: unsafe HTML or JavaScript`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert(!forbiddenLocationKeys.has(key), `${path}: forbidden precise-location field ${key}`);
      scan(child, `${path}.${key}`);
    }
  }
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

const parsed = {};
for (const file of contentFiles) {
  parsed[file] = JSON.parse(await readFile(file, "utf8"));
  assert(Array.isArray(parsed[file]), `${file}: top level must be an array`);
  scan(parsed[file], file);
}

const updates = parsed["content/updates.json"];
const allowedStatuses = new Set([
  "reported",
  "corroborating",
  "verified",
  "disputed",
  "retracted",
]);

for (const update of updates) {
  for (const key of [
    "id",
    "language",
    "title",
    "summary",
    "city",
    "zone",
    "eventTime",
    "publishedAt",
    "status",
    "sensitivity",
    "sources",
    "reviewers",
  ]) {
    assert(update[key] !== undefined && update[key] !== "", `update ${update.id}: missing ${key}`);
  }
  assert(["en", "hi"].includes(update.language), `update ${update.id}: invalid language`);
  assert(allowedStatuses.has(update.status), `update ${update.id}: invalid status`);
  assert(validDate(update.eventTime), `update ${update.id}: invalid eventTime`);
  assert(validDate(update.publishedAt), `update ${update.id}: invalid publishedAt`);
  if (update.expiresAt) assert(validDate(update.expiresAt), `update ${update.id}: invalid expiresAt`);
  assert(update.sources.length > 0, `update ${update.id}: at least one source is required`);
  assert(update.reviewers.length > 0, `update ${update.id}: at least one reviewer is required`);
  if (update.sensitivity === "high") {
    assert(update.reviewers.length >= 2, `update ${update.id}: high sensitivity requires two reviewers`);
  }
  if (update.status === "verified") {
    assert(
      update.sources.some((source) => ["A", "B", "C"].includes(source.tier)),
      `update ${update.id}: verified status requires a tier A, B, or C source`,
    );
  }
  for (const source of update.sources) {
    assert(["A", "B", "C", "D", "E"].includes(source.tier), `update ${update.id}: invalid source tier`);
    assert(validDate(source.accessedAt), `update ${update.id}: invalid source access time`);
  }
}

const englishIds = updates.filter((item) => item.language === "en").map((item) => item.id).sort();
const hindiIds = updates.filter((item) => item.language === "hi").map((item) => item.id).sort();
assert(JSON.stringify(englishIds) === JSON.stringify(hindiIds), "updates: English/Hindi parity check failed");

for (const item of parsed["content/media.json"]) {
  assert(item.reviewers?.length >= 2, `media ${item.id}: two reviewers are required`);
  assert(item.legalReview === "approved", `media ${item.id}: legal review must be approved`);
  assert(item.redaction, `media ${item.id}: redaction note is required`);
  assert(item.file?.startsWith("/media/"), `media ${item.id}: only local public derivatives are allowed`);
  assert(!item.file.includes("drive.google.com"), `media ${item.id}: private Drive links are forbidden`);
}

console.log(`Content validation passed (${updates.length} bilingual update records).`);
