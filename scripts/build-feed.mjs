import {
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const updates = JSON.parse(await readFile("content/updates.json", "utf8"));
const privateDirectory = ".private";
const privateKeyPath = `${privateDirectory}/feed-private.pem`;
const feedPath = "public/feed/updates.json";
const signaturePath = "public/feed/updates.sig";
const publicKeyPath = "public/feed/public-key.txt";

await mkdir(privateDirectory, { recursive: true });
await mkdir("public/feed", { recursive: true });

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const publicUpdates = updates
  .filter((item) => !item.unpublished)
  .map((item) => {
    const publicItem = { ...item };
    delete publicItem.reviewers;
    delete publicItem.sensitivity;
    return publicItem;
  })
  .sort((a, b) => {
    const time =
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    return (
      time ||
      `${a.language}-${a.id}`.localeCompare(`${b.language}-${b.id}`)
    );
  });

let privateKey = null;
const verifyCommittedFeedOnly =
  process.env.VERIFY_COMMITTED_FEED_ONLY === "true";

if (!verifyCommittedFeedOnly && process.env.FEED_SIGNING_PRIVATE_KEY) {
  privateKey = process.env.FEED_SIGNING_PRIVATE_KEY.replace(/\\n/g, "\n");
} else if (!verifyCommittedFeedOnly && existsSync(privateKeyPath)) {
  privateKey = await readFile(privateKeyPath, "utf8");
}

if (privateKey) {
  const publicKey = createPublicKey(privateKey).export({
    type: "spki",
    format: "pem",
  });
  const feed = {
    generatedAt: new Date().toISOString(),
    languages: ["en", "hi"],
    updates: publicUpdates,
  };
  const serialized = stable(feed);
  const signature = sign(null, Buffer.from(serialized), privateKey).toString(
    "base64",
  );

  await writeFile(feedPath, `${serialized}\n`);
  await writeFile(signaturePath, `${signature}\n`);
  await writeFile(publicKeyPath, String(publicKey));
  console.log(`Signed feed generated with ${publicUpdates.length} public records.`);
} else {
  const required = [feedPath, signaturePath, publicKeyPath];
  const missing = required.filter((path) => !existsSync(path));
  if (missing.length) {
    throw new Error(
      `Signed feed files are missing (${missing.join(", ")}). Set FEED_SIGNING_PRIVATE_KEY to generate them.`,
    );
  }

  const [serializedWithNewline, signatureText, publicKey] = await Promise.all([
    readFile(feedPath, "utf8"),
    readFile(signaturePath, "utf8"),
    readFile(publicKeyPath, "utf8"),
  ]);
  const serialized = serializedWithNewline.trimEnd();
  const signature = Buffer.from(signatureText.trim(), "base64");

  if (!verify(null, Buffer.from(serialized), publicKey, signature)) {
    throw new Error("Committed public feed signature is invalid.");
  }

  const existingFeed = JSON.parse(serialized);
  const expectedPublicContent = stable({
    languages: ["en", "hi"],
    updates: publicUpdates,
  });
  const existingPublicContent = stable({
    languages: existingFeed.languages,
    updates: existingFeed.updates,
  });

  if (existingPublicContent !== expectedPublicContent) {
    throw new Error(
      "Committed signed feed is out of date. An authorized editor must set FEED_SIGNING_PRIVATE_KEY and rebuild it.",
    );
  }

  console.log(
    `Verified committed signed feed with ${publicUpdates.length} public records.`,
  );
}

if (
  !process.env.FEED_SIGNING_PRIVATE_KEY &&
  !existsSync(privateKeyPath) &&
  process.env.GENERATE_LOCAL_FEED_KEY === "true"
) {
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(privateKeyPath, pair.privateKey, { mode: 0o600 });
  console.warn(
    "Generated a local feed signing key. Run the build again to sign with it, and back it up securely.",
  );
}
