import { createClient } from "@libsql/client";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "tx-"));
const url = `file:${path.join(dir, "t.db").replaceAll("\\", "/")}`;

// Does BEGIN via execute() span later execute() calls on the file client?
const a = createClient({ url });
await a.execute("BEGIN");
await a.execute("CREATE TABLE t (x INTEGER)");
await a.execute("INSERT INTO t VALUES (1)");
try { await a.execute("ROLLBACK"); console.log("file client: ROLLBACK accepted"); }
catch (e) { console.log("file client: ROLLBACK failed:", (e as Error).message); }
const after = await a.execute("SELECT name FROM sqlite_master WHERE type='table'");
console.log("file client: tables after rollback ->", JSON.stringify(after.rows.map(r => r.name)));

// And a COMMIT with no transaction open?
try { await a.execute("COMMIT"); console.log("file client: stray COMMIT accepted (!)"); }
catch (e) { console.log("file client: stray COMMIT errors ->", (e as Error).message); }
try { await a.execute("ROLLBACK"); console.log("file client: stray ROLLBACK accepted (!)"); }
catch (e) { console.log("file client: stray ROLLBACK errors ->", (e as Error).message); }
