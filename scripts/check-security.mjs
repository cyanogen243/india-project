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
// reviewed act. `ContributeForm` accepts image uploads: they are re-encoded
// server-side before storage, which strips embedded author and location
// metadata, and nothing reaches the public site without admin approval.
const approvedForms = [
  "app/components/VolunteerForm.tsx",
  "app/components/ContributeForm.tsx",
  "app/components/RecoveryCodeLookup.tsx",
  "app/admin/AdminApp.tsx",
];

for (const path of paths) {
  const source = await readFile(path, "utf8");
  if (/<iframe/i.test(source)) throw new Error(`${path}: iframe embeds are forbidden`);
  if (/next\/font\/google|fonts\.googleapis\.com/i.test(source)) {
    throw new Error(`${path}: third-party fonts are forbidden`);
  }
  if (/<form/i.test(source)) {
    const normalised = path.split("\\").join("/");
    if (!approvedForms.some((approved) => normalised.endsWith(approved))) {
      throw new Error(`${path}: unreviewed form surface`);
    }
  }
}

// Read from the config that actually serves them. This checked a Worker entry
// point that no deployment used, so a header dropped from the Next config would
// not have been noticed.
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
