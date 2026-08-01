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

// Every form surface stays on this list so adding one remains a deliberate,
// reviewed act.
const approvedForms = [
  "app/components/VolunteerForm.tsx",
  "app/components/ContributeForm.tsx",
  "app/components/RecoveryCodeLookup.tsx",
  "app/admin/AdminApp.tsx",
];

// Uploads are allowed only on the two surfaces built to receive them, both of
// which re-encode every image server-side — stripping the author and GPS
// metadata design tools and cameras embed — and publish nothing without
// approval. Deliberately shorter than `approvedForms`: being an approved form
// is not enough to accept files.
const approvedUploadForms = [
  "app/components/ContributeForm.tsx",
  "app/admin/AdminApp.tsx",
];

for (const path of paths) {
  const source = await readFile(path, "utf8");
  if (/<iframe/i.test(source)) throw new Error(`${path}: iframe embeds are forbidden`);
  if (/next\/font\/google|fonts\.googleapis\.com/i.test(source)) {
    throw new Error(`${path}: third-party fonts are forbidden`);
  }
  const normalised = path.split("\\").join("/");
  if (
    /<form/i.test(source) &&
    !approvedForms.some((approved) => normalised.endsWith(approved))
  ) {
    throw new Error(`${path}: unreviewed form surface`);
  }
  // Keyed on the input, not the form around it: an uploader wired straight to
  // fetch never mentions <form> and is held to the same list.
  if (
    /type=["']file["']/i.test(source) &&
    !approvedUploadForms.some((approved) => normalised.endsWith(approved))
  ) {
    throw new Error(`${path}: file uploads are forbidden on this surface`);
  }
}

const nextConfig = await readFile("next.config.ts", "utf8");
for (const header of [
  "Content-Security-Policy",
  "Referrer-Policy",
  "X-Content-Type-Options",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
]) {
  if (!nextConfig.includes(header)) throw new Error(`Missing security header: ${header}`);
}

console.log(`Security checks passed (${paths.length} content and application files scanned).`);
