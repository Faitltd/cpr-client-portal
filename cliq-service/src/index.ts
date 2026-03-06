import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { requestLogger } from "./middleware/logger";
import { initWebSocket } from "./services/websocket";
import { startPoller, stopPoller } from "./services/message-poller";
import healthRouter from "./routes/health";
import chatRouter from "./routes/chat";

const app = express();

app.use(
  cors({
    origin: env.ALLOWED_ORIGINS.length ? env.ALLOWED_ORIGINS : "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Project-Slug"],
  })
);

app.use(express.json());
app.use(requestLogger);

app.use("/api/health", healthRouter);
app.use("/api/chat", chatRouter);

const server = http.createServer(app);

initWebSocket(server);
startPoller();

server.listen(env.PORT, () => {
  console.log(`cliq-service listening on port ${env.PORT}`);
  console.log(`ALLOW_CHANNEL_CREATE=${env.ALLOW_CHANNEL_CREATE}`);
});

function shutdown() {
  stopPoller();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
