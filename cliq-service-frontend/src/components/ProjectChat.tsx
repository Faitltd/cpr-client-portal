import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { io, Socket } from "socket.io-client";

interface Message {
  sender: string;
  text: string;
  time: string;
  isTeam: boolean;
  fileUrl?: string;
  localId?: string;
}

interface Props {
  projectSlug: string;
  authToken: string;
  apiBaseUrl: string;
}

interface FileUploadResponse {
  status: "uploaded";
  filename: string;
  downloadUrl: string;
  correlationId: string;
}

const CLIENT_PREFIX = "[CLIENT] ";
const FILE_MESSAGE_PATTERN =
  /📎\s*File:\s*(.+?)\s+[—-]\s*((?:https?:\/\/|\/api\/files\/download\/)[^\s<>"')\]]+)/u;
const URL_PATTERN = /((?:https?:\/\/|\/api\/files\/download\/)[^\s<>"')\]]+)/i;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// Strip the "[CLIENT] " prefix that the backend prepends for display.
function displayText(raw: string): string {
  return raw.startsWith(CLIENT_PREFIX) ? raw.slice(CLIENT_PREFIX.length) : raw;
}

function normalizeUrl(url: string, apiBaseUrl: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  try {
    return new URL(url, apiBaseUrl).toString();
  } catch {
    return `${apiBaseUrl.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
  }
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, "");
}

function extractFileUrlFromText(text: string): string | undefined {
  const explicit = text.match(FILE_MESSAGE_PATTERN);
  if (explicit?.[2]) return trimTrailingPunctuation(explicit[2]);

  const fallback = text.match(URL_PATTERN);
  if (fallback?.[1]) return trimTrailingPunctuation(fallback[1]);
  return undefined;
}

function extractFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url, "http://localhost");
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    if (!last) return "file";
    return decodeURIComponent(last).replace(/^\d+-/, "");
  } catch {
    return "file";
  }
}

function inferFileName(message: Message): string {
  const explicit = message.text.match(FILE_MESSAGE_PATTERN);
  if (explicit?.[1]) return explicit[1].trim();
  if (message.fileUrl) return extractFilenameFromUrl(message.fileUrl);
  const fromText = extractFileUrlFromText(message.text);
  if (fromText) return extractFilenameFromUrl(fromText);
  return "file";
}

function resolveFileUrl(message: Message): string | undefined {
  return message.fileUrl ?? extractFileUrlFromText(message.text);
}

function isImageFile(url: string, filename: string): boolean {
  const lowerName = filename.toLowerCase();
  if (IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return true;
  try {
    const lowerPath = new URL(url, "http://localhost").pathname.toLowerCase();
    return IMAGE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
  } catch {
    return false;
  }
}

export function ProjectChat({ projectSlug, authToken, apiBaseUrl }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Set of "${time}|${text}" keys for every message added to state, used for dedup (b).
  const seenKeysRef = useRef<Set<string>>(new Set());
  // Recent optimistic sends { text: "[CLIENT] ...", time: epoch ms }, used for dedup (a).
  const recentSendsRef = useRef<{ text: string; time: number }[]>([]);

  const jsonAuthHeaders = {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };

  // Fetch history on mount.
  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/api/chat/history/${projectSlug}`, {
          headers: jsonAuthHeaders,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${res.status} ${body}`);
        }
        const data = (await res.json()) as { messages: Message[] };
        if (!cancelled) {
          const incoming = data.messages.map((m) => ({
            ...m,
            fileUrl: resolveFileUrl(m),
          }));
          // Populate seenKeys from the initial load so socket duplicates are filtered.
          for (const m of incoming) {
            seenKeysRef.current.add(`${m.time}|${m.text}`);
          }
          setMessages(incoming);
        }
      } catch (err) {
        if (!cancelled) setError(`Failed to load history: ${(err as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchHistory();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, apiBaseUrl]);

  // Socket.IO connection for real-time updates.
  useEffect(() => {
    const socket: Socket = io(apiBaseUrl, {
      query: { projectSlug },
      auth: { token: authToken },
    });

    socket.on("connect", () => {
      setConnected(true);
      setHasConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("new_message", (msg: Message) => {
      const normalized: Message = {
        ...msg,
        fileUrl: resolveFileUrl(msg),
      };
      const key = `${normalized.time}|${normalized.text}`;

      // Dedup (b): message already seen from history load or a previous socket push.
      if (seenKeysRef.current.has(key)) return;

      // Dedup (a): matches a recently sent optimistic client message (within 30 s).
      if (!normalized.isTeam) {
        const now = Date.now();
        recentSendsRef.current = recentSendsRef.current.filter((s) => now - s.time < 30_000);
        if (recentSendsRef.current.some((s) => s.text === normalized.text)) {
          seenKeysRef.current.add(key);
          return;
        }
      }

      seenKeysRef.current.add(key);
      setMessages((prev) => [...prev, normalized]);
    });

    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, authToken, apiBaseUrl]);

  // Scroll to bottom whenever messages change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    // Optimistic update.
    const optimistic: Message = {
      sender: "You",
      text: `[CLIENT] ${text}`,
      time: new Date().toISOString(),
      isTeam: false,
    };

    // Track for dedup (a): mark this text as recently sent so the poller broadcast is ignored.
    recentSendsRef.current.push({ text: `[CLIENT] ${text}`, time: Date.now() });
    // Mark the optimistic key so any exact duplicate from socket is ignored too.
    seenKeysRef.current.add(`${optimistic.time}|${optimistic.text}`);

    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch(`${apiBaseUrl}/api/chat/send`, {
        method: "POST",
        headers: jsonAuthHeaders,
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status} ${body}`);
      }
    } catch (err) {
      setError(`Failed to send: ${(err as Error).message}`);
      // Roll back the optimistic message.
      setMessages((prev) => prev.filter((m) => m !== optimistic));
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleAttachmentClick() {
    if (uploading) return;
    fileInputRef.current?.click();
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;

    const optimisticId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      sender: "You",
      text: `[CLIENT] 📎 Uploading ${file.name}...`,
      time: new Date().toISOString(),
      isTeam: false,
      localId: optimisticId,
    };

    setMessages((prev) => [...prev, optimistic]);
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectSlug", projectSlug);

      const res = await fetch(`${apiBaseUrl}/api/files/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status} ${body}`);
      }

      const data = (await res.json()) as FileUploadResponse;
      const realMessage: Message = {
        sender: "You",
        text: `[CLIENT] 📎 File: ${file.name} — ${data.downloadUrl}`,
        time: new Date().toISOString(),
        isTeam: false,
        fileUrl: data.downloadUrl,
      };

      recentSendsRef.current.push({ text: realMessage.text, time: Date.now() });
      seenKeysRef.current.add(`${realMessage.time}|${realMessage.text}`);

      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.localId !== optimisticId);
        const alreadyPresent = withoutOptimistic.some(
          (m) => !m.isTeam && m.text === realMessage.text
        );
        if (alreadyPresent) return withoutOptimistic;
        return [...withoutOptimistic, realMessage];
      });
    } catch (err) {
      setError(`Failed to upload: ${(err as Error).message}`);
      setMessages((prev) => prev.filter((m) => m.localId !== optimisticId));
    } finally {
      setUploading(false);
    }
  }

  function renderMessageContent(msg: Message) {
    const fileUrl = resolveFileUrl(msg);
    if (!fileUrl) {
      return <div className="message-bubble">{displayText(msg.text)}</div>;
    }

    const filename = inferFileName(msg);
    const absoluteUrl = normalizeUrl(fileUrl, apiBaseUrl);
    const image = isImageFile(absoluteUrl, filename);

    return (
      <div className="message-bubble file-bubble">
        <a
          className="file-link"
          href={absoluteUrl}
          target="_blank"
          rel="noreferrer"
        >
          {image ? `📎 ${filename}` : `📄 ${filename}`}
        </a>
        {image && (
          <a href={absoluteUrl} target="_blank" rel="noreferrer" className="file-thumb-link">
            <img src={absoluteUrl} alt={filename} className="file-thumb" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>Project Chat</h2>
        <span>#{projectSlug}</span>
      </div>

      {hasConnected && !connected && (
        <div style={{ color: "#888", fontSize: "0.8rem", textAlign: "center", padding: "4px 0" }}>
          Reconnecting…
        </div>
      )}

      {loading && <div className="chat-status loading">Loading messages...</div>}
      {error && <div className="chat-status error">{error}</div>}

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={msg.localId ?? i} className={`message-row ${msg.isTeam ? "team" : "client"}`}>
            <span className="message-meta">
              {msg.sender} &middot; {formatTime(msg.time)}
            </span>
            {renderMessageContent(msg)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          ref={fileInputRef}
          type="file"
          className="file-input-hidden"
          onChange={handleFileSelected}
        />
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          type="button"
          className="attach-button"
          onClick={handleAttachmentClick}
          disabled={uploading}
          title="Attach file"
          aria-label="Attach file"
        >
          📎
        </button>
        <button
          type="button"
          className="send-button"
          onClick={handleSend}
          disabled={sending || input.trim() === ""}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
