import axios, { AxiosError } from "axios";
import { env } from "../config/env";
import { getToken } from "./zoho-auth";
import { insertMessage, synthesizeId } from "./db";
import type { ChannelResult, Message } from "../types";

const BASE = `${env.ZOHO_API_DOMAIN}/cliq/v2`;

export function channelName(projectSlug: string): string {
  return `cpr-client-${projectSlug}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return { Authorization: `Zoho-oauthtoken ${token}` };
}

function log(cid: string, msg: string): void {
  console.log(`[${cid}] ${msg}`);
}

/**
 * Ensures the Cliq channel for a project exists.
 *
 * - If the channel is found, returns { channelName, channelCreated: false }.
 * - If the channel is missing and ALLOW_CHANNEL_CREATE=true, creates it and
 *   returns { channelName, channelCreated: true }.
 * - If the channel is missing and ALLOW_CHANNEL_CREATE=false (default), throws.
 */
export async function ensureChannel(
  projectSlug: string,
  correlationId: string
): Promise<ChannelResult> {
  const name = channelName(projectSlug);
  const headers = await authHeaders();

  try {
    const res = await axios.get(`${BASE}/channelsbyname/${name}`, { headers });
    log(correlationId, `Zoho GET /channelsbyname/${name} → ${res.status}`);
    return { channelName: name, channelCreated: false };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    log(correlationId, `Zoho GET /channelsbyname/${name} → ${status ?? "no-response"}`);
    if (status !== 404) throw err;
  }

  // Channel does not exist.
  if (!env.ALLOW_CHANNEL_CREATE) {
    throw new Error(
      `Channel "${name}" does not exist and ALLOW_CHANNEL_CREATE is false. ` +
        `Set ALLOW_CHANNEL_CREATE=true to allow automatic channel creation.`
    );
  }

  const createRes = await axios.post(
    `${BASE}/channels`,
    {
      name,
      description: `Client channel for ${projectSlug}`,
      visibility: "private",
    },
    { headers }
  );
  log(correlationId, `Zoho POST /channels (create "${name}") → ${createRes.status}`);

  return { channelName: name, channelCreated: true };
}

export async function postClientMessage(
  projectSlug: string,
  clientName: string,
  text: string,
  correlationId: string
): Promise<void> {
  const { channelName: name } = await ensureChannel(projectSlug, correlationId);
  const headers = await authHeaders();

  const messageText = `[CLIENT] ${text}`;
  const res = await axios.post(
    `${BASE}/channelsbyname/${name}/message`,
    {
      text: messageText,
      card: {
        title: `Message from ${clientName}`,
        theme: "modern-inline",
      },
    },
    { headers }
  );
  log(correlationId, `Zoho POST /channelsbyname/${name}/message → ${res.status}`);

  const now = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;
  const msgId: string =
    data?.id ?? data?.message?.id ?? synthesizeId(name, now, messageText, clientName);

  insertMessage({
    id: msgId,
    channelName: name,
    senderName: clientName,
    text: messageText,
    timestamp: Date.now(),
    isTeam: false,
    syncedFromCliq: false,
  });
}

export async function getChannelHistory(
  projectSlug: string,
  correlationId: string,
  limit = 50
): Promise<Message[]> {
  const { channelName: name } = await ensureChannel(projectSlug, correlationId);
  const headers = await authHeaders();

  const response = await axios.get<{
    data: Array<{ id?: string; sender: { name: string }; message: string; time: string }>;
  }>(`${BASE}/channelsbyname/${name}/messages`, {
    headers,
    params: { limit },
  });
  log(correlationId, `Zoho GET /channelsbyname/${name}/messages → ${response.status}`);

  const items = response.data?.data ?? [];

  return items.map((item) => {
    const senderName = item.sender?.name ?? "Unknown";
    const text = item.message ?? "";
    const time = item.time ?? "";
    const isTeam = !text.startsWith("[CLIENT] ");

    const msgId =
      item.id ?? synthesizeId(name, time, text, senderName);

    insertMessage({
      id: msgId,
      channelName: name,
      senderName,
      text,
      timestamp: time ? (new Date(time).getTime() || Date.now()) : Date.now(),
      isTeam,
      syncedFromCliq: true,
    });

    return { sender: senderName, text, time, isTeam };
  });
}
