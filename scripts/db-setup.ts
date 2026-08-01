import { mkdir } from "node:fs/promises";
import { ensureDatabase } from "../app/lib/database";
import { seedContributions } from "./seed-contributions";

await mkdir("data", { recursive: true });
await ensureDatabase();
await seedContributions();
console.log("Database migrated and bundled content seeded.");
