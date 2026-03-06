import fs from "node:fs";
import path from "node:path";
import { Router, Request, Response } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth";
import { channelName, postClientMessageWithCard } from "../services/cliq-channel";
import { broadcastToProject } from "../services/websocket";
import { env } from "../config/env";
import type { Message } from "../types";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
  },
});

const channelPrefix = "cpr-client-";

function sanitizeFilename(raw: string): string {
  const base = path.basename(raw || "file");
  const safe = base.replace(/[\u0000-\u001f\u007f/\\]/g, "_").replace(/\s+/g, " ").trim();
  return safe || "file";
}

function normalizePathParam(value: string): string {
  return value.replace(/[\\/]/g, "");
}

function ensureProjectScope(req: Request, channel: string): boolean {
  if (!channel.startsWith(channelPrefix)) return false;
  const slug = channel.slice(channelPrefix.length);
  return slug === req.user?.projectSlug;
}

router.post("/upload", authenticate, (req: Request, res: Response): void => {
  upload.single("file")(req, res, async (err: unknown) => {
    const cid = req.correlationId;

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: `File exceeds ${env.MAX_FILE_SIZE_MB} MB limit` });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }

    if (err) {
      res.status(400).json({ error: "Invalid multipart/form-data payload" });
      return;
    }

    const projectSlug = typeof req.body?.projectSlug === "string" ? req.body.projectSlug.trim() : "";
    if (!projectSlug) {
      res.status(400).json({ error: "projectSlug is required" });
      return;
    }

    if (projectSlug !== req.user?.projectSlug) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const user = req.user!;

    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    const originalFilename = path.basename(req.file.originalname || "file") || "file";
    const safeOriginalFilename = sanitizeFilename(originalFilename);
    const name = channelName(projectSlug);
    const timestamp = Date.now();
    const storedFilename = `${timestamp}-${safeOriginalFilename}`;
    const uploadRoot = path.resolve(env.UPLOAD_DIR);
    const channelDir = path.join(uploadRoot, name);
    const absoluteFilePath = path.join(channelDir, storedFilename);
    const downloadUrl = `/api/files/download/${encodeURIComponent(name)}/${encodeURIComponent(storedFilename)}`;
    const messageText = `[CLIENT] 📎 File: ${originalFilename} — ${downloadUrl}`;

    try {
      await fs.promises.mkdir(channelDir, { recursive: true });
      await fs.promises.writeFile(absoluteFilePath, req.file.buffer);

      const posted = await postClientMessageWithCard(projectSlug, user.name, messageText, cid, {
        title: `File from ${user.name}`,
        theme: "modern-inline",
      });

      const outgoing: Message = {
        sender: user.name,
        text: messageText,
        time: posted.time,
        isTeam: false,
        fileUrl: downloadUrl,
      };
      broadcastToProject(projectSlug, outgoing);

      res.json({
        status: "uploaded",
        filename: storedFilename,
        downloadUrl,
        correlationId: cid,
      });
    } catch (uploadErr) {
      console.error(`[${cid}] file upload failed:`, (uploadErr as Error).message);
      res.status(502).json({ error: "Failed to upload file", correlationId: cid });
    }
  });
});

router.get("/download/:channelName/:filename", authenticate, async (req: Request, res: Response): Promise<void> => {
  const channel = normalizePathParam(req.params.channelName);
  const filename = normalizePathParam(req.params.filename);

  if (!channel || !filename || channel !== req.params.channelName || filename !== req.params.filename) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!ensureProjectScope(req, channel)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  const absoluteFilePath = path.resolve(uploadRoot, channel, filename);
  const allowedRoot = path.resolve(uploadRoot, channel);
  if (!absoluteFilePath.startsWith(`${allowedRoot}${path.sep}`)) {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }

  try {
    const stat = await fs.promises.stat(absoluteFilePath);
    if (!stat.isFile()) {
      res.status(404).json({ error: "File not found" });
      return;
    }
  } catch {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.type(path.extname(filename) || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, '\\"')}"`);
  res.sendFile(absoluteFilePath);
});

export default router;
