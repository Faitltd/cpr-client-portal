import axios from "axios";
import { env } from "../config/env";

interface TokenState {
  accessToken: string;
  expiresAt: number; // ms since epoch
}

let state: TokenState | null = null;

async function refreshAccessToken(): Promise<TokenState> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN,
  });

  const response = await axios.post<{
    access_token: string;
    expires_in: number;
    error?: string;
  }>(`${env.ZOHO_API_DOMAIN}/oauth/v2/token`, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const { access_token, expires_in, error } = response.data;
  if (error || !access_token) {
    throw new Error(`Zoho token refresh failed: ${error ?? "no access_token"}`);
  }

  return {
    accessToken: access_token,
    // expires_in is in seconds; subtract 60s buffer
    expiresAt: Date.now() + (expires_in - 60) * 1000,
  };
}

export async function getToken(): Promise<string> {
  if (!state || Date.now() >= state.expiresAt) {
    state = await refreshAccessToken();
  }
  return state.accessToken;
}
