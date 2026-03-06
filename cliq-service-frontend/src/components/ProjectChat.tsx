import { useEffect, useRef, useState } from "react";

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
  const bottomRef = useRef<HTMLDivElement>(null);

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
        if (!cancelled) setMessages(data.messages);
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
