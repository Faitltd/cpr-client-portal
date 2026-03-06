import "dotenv/config";
import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { requestLogger } from "./middleware/logger";
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

app.listen(env.PORT, () => {
  console.log(`cliq-service listening on port ${env.PORT}`);
  console.log(`ALLOW_CHANNEL_CREATE=${env.ALLOW_CHANNEL_CREATE}`);
});
