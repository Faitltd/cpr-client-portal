import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth";
import {
  channelName,
  ensureChannel,
  postClientMessage,
  getChannelHistory,
} from "../services/cliq-channel";
import { getMessages } from "../services/db";
import { extractFileUrlFromText } from "../services/file-links";
import type { Message } from "../types";

const router = Router();

/**
 * Resolves the effective projectSlug for a request.
 * Internal tools may supply X-Project-Slug to override the JWT claim.
 */
function resolveProjectSlug(req: Request): string {
  const override = req.headers["x-project-slug"];
  if (typeof override === "string" && override.trim() !== "") {
    return override.trim();
  }
  return req.user!.projectSlug;
}

// POST /api/chat/send
router.post("/send", authenticate, async (req: Request, res: Response): Promise<void> => {
  const cid = req.correlationId;
  const projectSlug = resolveProjectSlug(req);
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    await postClientMessage(projectSlug, req.user!.name, message.trim(), cid);
    res.json({ status: "sent", timestamp: new Date().toISOString() });
  } catch (err) {
    console.error(`[${cid}] postClientMessage failed:`, (err as Error).message);
    res.status(502).json({ error: "Failed to send message to Cliq" });
  }
});

// GET /api/chat/history/:projectSlug
router.get("/history/:projectSlug", authenticate, async (req: Request, res: Response): Promise<void> => {
  const cid = req.correlationId;
  const projectSlug = resolveProjectSlug(req);

  // Ensure URL param matches the resolved slug (JWT or override).
  if (req.params.projectSlug !== projectSlug) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Compute channel name without a Cliq round-trip for the DB lookup.
  const name = channelName(projectSlug);
  const cached = getMessages(name, 50);

  if (cached.length > 0) {
    // Fast path: serve from DB cache without hitting Cliq.
    const messages: Message[] = cached.map((m) => ({
      sender: m.senderName,
      text: m.text,
      time: new Date(m.timestamp).toISOString(),
      isTeam: m.isTeam,
      fileUrl: extractFileUrlFromText(m.text),
    }));
    res.json({ messages });
    return;
  }

  // Slow path: DB is empty — fetch from Cliq (this also populates the DB).
  try {
    const messages = await getChannelHistory(projectSlug, cid);
    res.json({ messages });
  } catch (err) {
    console.error(`[${cid}] getChannelHistory failed:`, (err as Error).message);

    // Final fallback: check if a concurrent request populated the DB while we waited.
    const fallback = getMessages(name, 50);
    if (fallback.length > 0) {
      const messages: Message[] = fallback.map((m) => ({
        sender: m.senderName,
        text: m.text,
        time: new Date(m.timestamp).toISOString(),
        isTeam: m.isTeam,
        fileUrl: extractFileUrlFromText(m.text),
      }));
      res.json({ messages, correlationId: cid, warning: "served_from_cache_only" });
      return;
    }

    res.status(502).json({
      error: "Failed to fetch message history from Cliq",
      correlationId: cid,
    });
  }
});

// GET /api/chat/debug/:projectSlug
router.get("/debug/:projectSlug", authenticate, async (req: Request, res: Response): Promise<void> => {
  const cid = req.correlationId;
  const projectSlug = resolveProjectSlug(req);

  if (req.params.projectSlug !== projectSlug) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  try {
    const { channelName: resolvedChannel, channelCreated } = await ensureChannel(projectSlug, cid);
    const messages = await getChannelHistory(projectSlug, cid, 5);

    res.json({
      correlationId: cid,
      channelName: resolvedChannel,
      channelCreated,
      messages,
    });
  } catch (err) {
    console.error(`[${cid}] debug failed:`, (err as Error).message);
    res.status(502).json({
      correlationId: cid,
      error: (err as Error).message,
    });
  }
});

export default router;
