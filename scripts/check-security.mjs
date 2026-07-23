import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};

for (const forbidden of ["@google-analytics", "gtag", "mixpanel", "segment", "hotjar"]) {
  if (Object.keys(dependencies).some((name) => name.includes(forbidden))) {
    throw new Error(`Forbidden tracking dependency: ${forbidden}`);
  }
}

const paths = [];
for await (const path of glob(["app/**/*.{ts,tsx}", "content/**/*.json"], {
  exclude: ["node_modules/**"],
})) {
  paths.push(path);
}

for (const path of paths) {
  const source = await readFile(path, "utf8");
  if (/<iframe/i.test(source)) throw new Error(`${path}: iframe embeds are forbidden`);
  if (/next\/font\/google|fonts\.googleapis\.com/i.test(source)) {
    throw new Error(`${path}: third-party fonts are forbidden`);
  }
  if (/<form/i.test(source)) throw new Error(`${path}: public forms are not allowed in v1`);
}

const worker = await readFile("worker/index.ts", "utf8");
for (const header of [
  "Content-Security-Policy",
  "Referrer-Policy",
  "X-Content-Type-Options",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
]) {
  if (!worker.includes(header)) throw new Error(`Missing security header: ${header}`);
}

console.log(`Security checks passed (${paths.length} content and application files scanned).`);
