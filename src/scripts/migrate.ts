import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

const { Client } = pg;

const migrationsDir = path.resolve(process.cwd(), "migrations");
const client = new Client({
  connectionString: config.databaseUrl,
  ssl: config.pgSsl ? { rejectUnauthorized: config.pgSslRejectUnauthorized } : false
});

await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const alreadyApplied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [file]
    );

    if (alreadyApplied.rowCount) {
      logger.info({ migration: file }, "Skipping already-applied migration");
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info({ migration: file }, "Applied migration");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
