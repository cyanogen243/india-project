import { mkdir } from "node:fs/promises";
import { ensureDatabase } from "../app/lib/database";

await mkdir("data", { recursive: true });
await ensureDatabase();
console.log("Database migrated and bundled content seeded.");
