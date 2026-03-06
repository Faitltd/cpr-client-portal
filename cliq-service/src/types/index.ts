export interface Message {
  sender: string;
  text: string;
  time: string;
  isTeam: boolean;
}

export interface JwtPayload {
  clientId: string;
  projectSlug: string;
  name: string;
}

/** Returned by ensureChannel so callers know whether a creation call was made. */
export interface ChannelResult {
  channelName: string;
  channelCreated: boolean;
}

// Augment Express Request to carry decoded JWT and per-request correlation ID.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      correlationId: string;
    }
  }
}
