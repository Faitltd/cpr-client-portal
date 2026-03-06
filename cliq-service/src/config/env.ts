import dotenv from "dotenv";
dotenv.config();

function require(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const env = {
  ZOHO_CLIENT_ID: require("ZOHO_CLIENT_ID"),
  ZOHO_CLIENT_SECRET: require("ZOHO_CLIENT_SECRET"),
  ZOHO_REFRESH_TOKEN: require("ZOHO_REFRESH_TOKEN"),
  ZOHO_API_DOMAIN: require("ZOHO_API_DOMAIN"),
  JWT_SECRET: require("JWT_SECRET"),
  PORT: parseInt(process.env.PORT ?? "3001", 10),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** When false (default), ensureChannel will throw rather than create a missing channel. */
  ALLOW_CHANNEL_CREATE: process.env.ALLOW_CHANNEL_CREATE === "true",
  /** Path to the SQLite DB file used as a message cache/audit log. */
  SQLITE_DB_PATH: process.env.SQLITE_DB_PATH ?? "./data/messages.db",
  /** Milliseconds between Cliq poll cycles for WebSocket push. */
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS ?? "5000", 10),
  /** Number of recent messages fetched from Cliq per poll cycle. */
  POLL_HISTORY_LIMIT: parseInt(process.env.POLL_HISTORY_LIMIT ?? "20", 10),
};
