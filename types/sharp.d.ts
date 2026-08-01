/**
 * sharp 0.35 ships types at lib/index.d.ts but its package.json `exports` map
 * has no `types` condition, so TypeScript's bundler resolution cannot see them.
 * This shim points the module name at the real declarations. It must stay a
 * type-only declaration — mapping "sharp" via tsconfig `paths` instead would
 * redirect Turbopack's runtime resolution to the .d.ts and break the import.
 */
declare module "sharp" {
  export * from "../node_modules/sharp/lib/index";
  export { default } from "../node_modules/sharp/lib/index";
}
