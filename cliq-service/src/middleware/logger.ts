import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  req.correlationId = randomUUID();
  const start = Date.now();

  console.log(`[${req.correlationId}] → ${req.method} ${req.path}`);

  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`[${req.correlationId}] ← ${res.statusCode} ${ms}ms`);
  });

  next();
}
