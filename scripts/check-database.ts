import { ensureDatabase } from "../app/lib/database";

const db = await ensureDatabase();
const [users, content, visitors] = await Promise.all([
  db.execute("SELECT COUNT(*) AS count FROM users WHERE active = 1"),
  db.execute(
    "SELECT COUNT(*) AS count FROM content_entries WHERE published_json IS NOT NULL",
  ),
  db.execute("SELECT total FROM visitor_totals WHERE id = 'site'"),
]);

console.log(
  JSON.stringify(
    {
      activeUsers: Number(users.rows[0]?.count ?? 0),
      publishedContent: Number(content.rows[0]?.count ?? 0),
      visitorCount: Number(visitors.rows[0]?.total ?? 0),
    },
    null,
    2,
  ),
);
