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

// Uploads are allowed on exactly the two surfaces built to receive them. Both
// re-encode every image server-side before storage — which is what strips the
// author and GPS metadata that design tools and phone cameras embed — and
// neither publishes anything without admin approval.
//
// This list is separate from `approvedForms`, and shorter, on purpose. The
// upload ban used to cover every form and was dropped wholesale when the
// contribution wall needed one exemption, which quietly made a file input on
// volunteer intake a passing build — against a README that promises intake
// "deliberately omits IDs, files". Widening this list is the reviewed act;
// being on `approvedForms` is not enough.
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
  if (/<form/i.test(source)) {
    const normalised = path.split("\\").join("/");
    if (!approvedForms.some((approved) => normalised.endsWith(approved))) {
      throw new Error(`${path}: unreviewed form surface`);
    }
    if (
      /type=["']file["']/i.test(source) &&
      !approvedUploadForms.some((approved) => normalised.endsWith(approved))
    ) {
      throw new Error(`${path}: file uploads remain forbidden on this form`);
    }
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
