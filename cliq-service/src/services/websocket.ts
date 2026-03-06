import http from "node:http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { Message } from "../types";

let io: Server;

export function initWebSocket(server: http.Server): void {
  io = new Server(server, {
    cors: {
      origin: env.ALLOWED_ORIGINS.length ? env.ALLOWED_ORIGINS : "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    const projectSlug = socket.handshake.query.projectSlug;
    const token = socket.handshake.auth.token as string | undefined;

    if (typeof projectSlug !== "string" || !projectSlug || !token) {
      socket.disconnect(true);
      return;
    }

    try {
      jwt.verify(token, env.JWT_SECRET);
    } catch {
      socket.disconnect(true);
      return;
    }

    const room = `project:${projectSlug}`;
    socket.join(room);
    console.log(`[ws] client connected to ${room}`);

    socket.on("disconnect", () => {
      console.log(`[ws] client disconnected from ${room}`);
    });
  });
}

export function broadcastToProject(projectSlug: string, message: Message): void {
  io.to(`project:${projectSlug}`).emit("new_message", message);
}

/** Returns a deduplicated list of projectSlugs with at least one connected socket. */
export function getActiveProjectSlugs(): string[] {
  const slugs = new Set<string>();
  for (const [room] of io.sockets.adapter.rooms) {
    if (room.startsWith("project:")) {
      slugs.add(room.slice("project:".length));
    }
  }
  return Array.from(slugs);
}
