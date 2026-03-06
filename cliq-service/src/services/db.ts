import Database from "better-sqlite3";
import { createHash } from "crypto";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { env } from "../config/env";

export interface DbMessage {
  id: string;
  channelName: string;
  senderName: string;
  text: string;
  timestamp: number; // epoch ms
  isTeam: boolean;
  syncedFromCliq: boolean;
}

function openDb(): Database.Database {
  const dbPath = resolve(env.SQLITE_DB_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_name TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      is_team INTEGER NOT NULL,
      synced_from_cliq INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel_time
      ON messages (channel_name, timestamp);
  `);

  return db;
}

const db = openDb();

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO messages
    (id, channel_name, sender_name, text, timestamp, is_team, synced_from_cliq)
  VALUES
    (@id, @channelName, @senderName, @text, @timestamp, @isTeam, @syncedFromCliq)
`);

const selectStmt = db.prepare(`
  SELECT id, channel_name, sender_name, text, timestamp, is_team, synced_from_cliq
  FROM messages
  WHERE channel_name = ?
  ORDER BY timestamp ASC
  LIMIT ?
`);

export function insertMessage(msg: DbMessage): void {
  insertStmt.run({
    id: msg.id,
    channelName: msg.channelName,
    senderName: msg.senderName,
    text: msg.text,
    timestamp: msg.timestamp,
    isTeam: msg.isTeam ? 1 : 0,
    syncedFromCliq: msg.syncedFromCliq ? 1 : 0,
  });
}

export function getMessages(channelName: string, limit: number): DbMessage[] {
  interface Row {
    id: string;
    channel_name: string;
    sender_name: string;
    text: string;
    timestamp: number;
    is_team: number;
    synced_from_cliq: number;
  }

  const rows = selectStmt.all(channelName, limit) as Row[];

  return rows.map((r) => ({
    id: r.id,
    channelName: r.channel_name,
    senderName: r.sender_name,
    text: r.text,
    timestamp: r.timestamp,
    isTeam: r.is_team === 1,
    syncedFromCliq: r.synced_from_cliq === 1,
  }));
}

const latestTimestampStmt = db.prepare(
  `SELECT MAX(timestamp) AS max_ts FROM messages WHERE channel_name = ?`
);

/** Returns the epoch-ms timestamp of the newest cached message for a channel, or 0 if none. */
export function getLatestTimestamp(channelName: string): number {
  const row = latestTimestampStmt.get(channelName) as { max_ts: number | null };
  return row?.max_ts ?? 0;
}

/** Synthesizes a stable message ID when Cliq does not provide one. */
export function synthesizeId(
  channelName: string,
  time: string,
  text: string,
  senderName: string
): string {
  return createHash("sha1")
    .update(`${channelName}:${time}:${senderName}:${text}`)
    .digest("hex");
}
