/**
 * Manual smoke test for /api/chat endpoints.
 *
 * What this does:
 *   - Creates/uses channel `cpr-client-test` in Zoho Cliq.
 *   - POSTs a test message via POST /api/chat/send.
 *   - Fetches history via GET /api/chat/history/test.
 *
 * Prerequisites:
 *   - .env must contain: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
 *     ZOHO_API_DOMAIN, JWT_SECRET
 *
 * Usage:
 *   Terminal 1:  npm run dev
 *   Terminal 2:  npm run test:manual
 *
 * After running, open Zoho Cliq and verify:
 *   - Channel `cpr-client-test` exists.
 *   - Message "Hello from cliq-service smoke test" appears.
 *   - The GET /history response below contains that message.
 */

import "dotenv/config";
import axios, { AxiosError } from "axios";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

const BASE = `http://localhost:${env.PORT}`;

const token = jwt.sign(
  { clientId: "test-client", projectSlug: "test", name: "Ray" },
  env.JWT_SECRET,
  { expiresIn: "1h" }
);

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

function printResult(label: string, status: number, data: unknown): void {
  console.log(`\n── ${label} ──────────────────────────`);
  console.log(`Status : ${status}`);
  console.log("Body   :", JSON.stringify(data, null, 2));
}

function printError(label: string, err: unknown): void {
  console.error(`\n── ${label} [ERROR] ──────────────────`);
  if (err instanceof AxiosError) {
    console.error(`Status : ${err.response?.status ?? "no response"}`);
    console.error("Body   :", JSON.stringify(err.response?.data ?? err.message, null, 2));
  } else {
    console.error(err);
  }
}

async function run(): Promise<void> {
  // POST /api/chat/send
  try {
    const sendRes = await axios.post(
      `${BASE}/api/chat/send`,
      { message: "Hello from cliq-service smoke test" },
      { headers }
    );
    printResult("POST /api/chat/send", sendRes.status, sendRes.data);
  } catch (err) {
    printError("POST /api/chat/send", err);
    process.exitCode = 1;
  }

  // GET /api/chat/history/test
  try {
    const historyRes = await axios.get(`${BASE}/api/chat/history/test`, { headers });
    printResult("GET /api/chat/history/test", historyRes.status, historyRes.data);
  } catch (err) {
    printError("GET /api/chat/history/test", err);
    process.exitCode = 1;
  }

  console.log("\nDone.");
}

run();
