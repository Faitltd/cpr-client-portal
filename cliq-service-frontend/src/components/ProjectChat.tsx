import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface Message {
  sender: string;
  text: string;
  time: string;
  isTeam: boolean;
}

interface Props {
  projectSlug: string;
  authToken: string;
  apiBaseUrl: string;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// Strip the "[CLIENT] " prefix that the backend prepends for display.
function displayText(raw: string): string {
  return raw.startsWith("[CLIENT] ") ? raw.slice(9) : raw;
}

export function ProjectChat({ projectSlug, authToken, apiBaseUrl }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Set of "${time}|${text}" keys for every message added to state, used for dedup (b).
  const seenKeysRef = useRef<Set<string>>(new Set());
  // Recent optimistic sends { text: "[CLIENT] ...", time: epoch ms }, used for dedup (a).
  const recentSendsRef = useRef<{ text: string; time: number }[]>([]);

  const authHeaders = {
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
          headers: authHeaders,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${res.status} ${body}`);
        }
        const data = (await res.json()) as { messages: Message[] };
        if (!cancelled) {
          // Populate seenKeys from the initial load so socket duplicates are filtered.
          for (const m of data.messages) {
            seenKeysRef.current.add(`${m.time}|${m.text}`);
          }
          setMessages(data.messages);
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
      const key = `${msg.time}|${msg.text}`;

      // Dedup (b): message already seen from history load or a previous socket push.
      if (seenKeysRef.current.has(key)) return;

      // Dedup (a): matches a recently sent optimistic client message (within 30 s).
      if (!msg.isTeam) {
        const now = Date.now();
        recentSendsRef.current = recentSendsRef.current.filter((s) => now - s.time < 30_000);
        if (recentSendsRef.current.some((s) => s.text === msg.text)) {
          seenKeysRef.current.add(key);
          return;
        }
      }

      seenKeysRef.current.add(key);
      setMessages((prev) => [...prev, msg]);
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
        headers: authHeaders,
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
          <div key={i} className={`message-row ${msg.isTeam ? "team" : "client"}`}>
            <span className="message-meta">
              {msg.sender} &middot; {formatTime(msg.time)}
            </span>
            <div className="message-bubble">{displayText(msg.text)}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button onClick={handleSend} disabled={sending || input.trim() === ""}>
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
