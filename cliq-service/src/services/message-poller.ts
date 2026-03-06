import { env } from "../config/env";
import { getLatestTimestamp } from "./db";
import { channelName, getChannelHistory } from "./cliq-channel";
import { getActiveProjectSlugs, broadcastToProject } from "./websocket";
import { extractFileUrlFromText } from "./file-links";

const RATE_LIMIT_WARN_THRESHOLD = 15;

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function pollCycle(): Promise<void> {
  const activeSlugs = getActiveProjectSlugs();

  // Skip silently when nobody is connected.
  if (activeSlugs.length === 0) return;

  if (activeSlugs.length > RATE_LIMIT_WARN_THRESHOLD) {
    console.warn(
      `[poller] WARNING: ${activeSlugs.length} active channels. ` +
        `Consider increasing POLL_INTERVAL_MS to stay within Zoho Cliq rate limits (~100 req/min).`
    );
  }

  console.log(`[poller] checking ${activeSlugs.length} active channel${activeSlugs.length === 1 ? "" : "s"}`);

  for (const slug of activeSlugs) {
    const name = channelName(slug);
    try {
      // Capture the latest cached timestamp BEFORE fetching from Cliq,
      // so we can detect what is genuinely new after the fetch.
      const latestTs = getLatestTimestamp(name);

      // getChannelHistory fetches from Cliq and inserts each message into SQLite as a side effect.
      const messages = await getChannelHistory(slug, "poller", env.POLL_HISTORY_LIMIT);

      // If the DB was empty before this cycle, the history load hasn't run yet.
      // Skip broadcasting to avoid duplicating what the history GET will return to the client.
      if (latestTs === 0) continue;

      const newMessages = messages.filter((m) => {
        const t = new Date(m.time).getTime();
        return !isNaN(t) && t > latestTs;
      });

      if (newMessages.length > 0) {
        console.log(
          `[poller] ${name}: ${newMessages.length} new message${newMessages.length === 1 ? "" : "s"} → broadcast`
        );
        for (const msg of newMessages) {
          const enriched = msg.fileUrl ? msg : { ...msg, fileUrl: extractFileUrlFromText(msg.text) };
          broadcastToProject(slug, enriched);
        }
      }
    } catch (err) {
      console.error(`[poller] error checking ${name}:`, (err as Error).message);
    }
  }
}

export function startPoller(): void {
  console.log(`[poller] started, interval=${env.POLL_INTERVAL_MS}ms`);
  pollTimer = setInterval(() => {
    pollCycle().catch((err) =>
      console.error("[poller] unexpected error in poll cycle:", (err as Error).message)
    );
  }, env.POLL_INTERVAL_MS);
}

export function stopPoller(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[poller] stopped");
  }
}
