import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const updates = JSON.parse(await readFile("content/updates.json", "utf8"));
const privateDirectory = ".private";
const privateKeyPath = `${privateDirectory}/feed-private.pem`;
const publicKeyPath = "public/feed/public-key.txt";

await mkdir(privateDirectory, { recursive: true });
await mkdir("public/feed", { recursive: true });

let privateKey;
let publicKey;

if (process.env.FEED_SIGNING_PRIVATE_KEY) {
  privateKey = process.env.FEED_SIGNING_PRIVATE_KEY.replace(/\\n/g, "\n");
} else if (existsSync(privateKeyPath)) {
  privateKey = await readFile(privateKeyPath, "utf8");
} else {
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
  await writeFile(privateKeyPath, privateKey, { mode: 0o600 });
  console.warn("Generated a local feed signing key. Back it up securely before production.");
}

if (!publicKey) {
  const { createPublicKey } = await import("node:crypto");
  publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
}

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
    const time = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    return time || `${a.language}-${a.id}`.localeCompare(`${b.language}-${b.id}`);
  });

const feed = {
  generatedAt: new Date().toISOString(),
  languages: ["en", "hi"],
  updates: publicUpdates,
};
const serialized = stable(feed);
const signature = sign(null, Buffer.from(serialized), privateKey).toString("base64");

await writeFile("public/feed/updates.json", `${serialized}\n`);
await writeFile("public/feed/updates.sig", `${signature}\n`);
await writeFile(publicKeyPath, String(publicKey));

console.log(`Signed feed generated with ${publicUpdates.length} public records.`);
