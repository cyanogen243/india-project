import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requiredPaths = [
  "dist/manifest.webmanifest",
  "dist/assets",
  ".netlify/functions-internal/server/server.mjs",
  ".netlify/functions-internal/nitro.json",
];

for (const path of requiredPaths) {
  await access(path);
}

const serverUrl = pathToFileURL(
  `${process.cwd()}/.netlify/functions-internal/server/server.mjs`,
);
serverUrl.searchParams.set("check", `${process.pid}-${Date.now()}`);
const { default: handler } = await import(serverUrl.href);
const response = await handler(new Request("https://example.netlify.app/"));
const html = await response.text();

if (response.status !== 200 || !html.includes("The India Project")) {
  throw new Error("Generated Netlify function did not render the homepage");
}

console.log("Netlify output check passed (public assets + server function).");
