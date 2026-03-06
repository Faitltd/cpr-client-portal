const CLIENT_FILE_PATTERN =
  /📎\s*File:\s*.+?\s+[—-]\s*((?:https?:\/\/|\/api\/files\/download\/)[^\s<>"')\]]+)/u;
const URL_PATTERN = /((?:https?:\/\/|\/api\/files\/download\/)[^\s<>"')\]]+)/i;

const ATTACHMENT_URL_KEYS = [
  "url",
  "href",
  "permalink",
  "download_url",
  "preview_url",
  "file_url",
  "thumbnail_url",
] as const;

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, "");
}

function normalizeUrlCandidate(value: string): string | undefined {
  const trimmed = trimTrailingPunctuation(value.trim());
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/api/files/download/")) return trimmed;
  return undefined;
}

export function extractFileUrlFromText(text: string): string | undefined {
  const filePatternMatch = text.match(CLIENT_FILE_PATTERN);
  if (filePatternMatch?.[1]) {
    return normalizeUrlCandidate(filePatternMatch[1]);
  }

  const genericUrlMatch = text.match(URL_PATTERN);
  if (genericUrlMatch?.[1]) {
    return normalizeUrlCandidate(genericUrlMatch[1]);
  }

  return undefined;
}

function extractUrlFromUnknown(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value == null) return undefined;

  if (typeof value === "string") {
    return normalizeUrlCandidate(value) ?? extractFileUrlFromText(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = extractUrlFromUnknown(item, depth + 1);
      if (match) return match;
    }
    return undefined;
  }

  if (typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ATTACHMENT_URL_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      const normalized = normalizeUrlCandidate(candidate);
      if (normalized) return normalized;
    }
  }

  for (const nested of Object.values(record)) {
    const match = extractUrlFromUnknown(nested, depth + 1);
    if (match) return match;
  }

  return undefined;
}

export function detectFileUrl(text: string, attachments?: unknown): string | undefined {
  return extractFileUrlFromText(text) ?? extractUrlFromUnknown(attachments);
}
