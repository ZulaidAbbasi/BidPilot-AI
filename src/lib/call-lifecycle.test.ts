import { describe, it, expect } from "vitest";
import { deriveLifecycle, labelTranscriptSource } from "./call-lifecycle";

describe("deriveLifecycle", () => {
  it("reports ready when nothing has started", () => {
    const v = deriveLifecycle({
      persistedStatus: null,
      sessionEndedAt: null,
      reconciledAt: null,
      clientStatus: "disconnected",
    });
    expect(v.phase).toBe("ready");
    expect(v.isLive).toBe(false);
    expect(v.timerRunning).toBe(false);
  });

  it("reports connecting from local hint before a call row exists", () => {
    const v = deriveLifecycle({
      persistedStatus: null,
      sessionEndedAt: null,
      reconciledAt: null,
      clientStatus: "connecting",
      localHint: "connecting",
    });
    expect(v.phase).toBe("connecting");
    expect(v.isLive).toBe(false);
  });

  it("only reports LIVE when persisted is in_progress AND client is connected", () => {
    const v = deriveLifecycle({
      persistedStatus: "in_progress",
      sessionEndedAt: null,
      reconciledAt: null,
      clientStatus: "connected",
    });
    expect(v.phase).toBe("live");
    expect(v.isLive).toBe(true);
    expect(v.timerRunning).toBe(true);
  });

  it("never shows LIVE when the client has disconnected mid-call", () => {
    const v = deriveLifecycle({
      persistedStatus: "in_progress",
      sessionEndedAt: null,
      reconciledAt: null,
      clientStatus: "disconnected",
    });
    expect(v.phase).toBe("ending");
    expect(v.isLive).toBe(false);
    expect(v.timerRunning).toBe(false);
  });

  it("never shows LIVE when session_ended_at is set, even if status is stale", () => {
    const v = deriveLifecycle({
      persistedStatus: "in_progress",
      sessionEndedAt: "2026-07-19T10:00:00Z",
      reconciledAt: null,
      clientStatus: "connected",
    });
    expect(v.phase).toBe("ending");
    expect(v.isLive).toBe(false);
    expect(v.timerRunning).toBe(false);
  });

  it("never shows LIVE while processing", () => {
    const v = deriveLifecycle({
      persistedStatus: "processing",
      sessionEndedAt: "2026-07-19T10:00:00Z",
      reconciledAt: null,
      clientStatus: "connected",
    });
    expect(v.phase).toBe("processing");
    expect(v.isLive).toBe(false);
    expect(v.timerRunning).toBe(false);
  });

  it("completed never resumes a timer", () => {
    const v = deriveLifecycle({
      persistedStatus: "completed",
      sessionEndedAt: "2026-07-19T10:00:00Z",
      reconciledAt: "2026-07-19T10:00:05Z",
      clientStatus: "disconnected",
    });
    expect(v.phase).toBe("completed");
    expect(v.isLive).toBe(false);
    expect(v.timerRunning).toBe(false);
    expect(v.isTerminal).toBe(true);
  });

  it("needs_review is terminal, non-live", () => {
    const v = deriveLifecycle({
      persistedStatus: "needs_review",
      sessionEndedAt: "2026-07-19T10:00:00Z",
      reconciledAt: "2026-07-19T10:00:05Z",
      clientStatus: "disconnected",
    });
    expect(v.phase).toBe("needs_review");
    expect(v.isLive).toBe(false);
    expect(v.isTerminal).toBe(true);
  });

  it("failed is terminal, danger tone", () => {
    const v = deriveLifecycle({
      persistedStatus: "failed",
      sessionEndedAt: null,
      reconciledAt: null,
      clientStatus: "disconnected",
    });
    expect(v.phase).toBe("failed");
    expect(v.tone).toBe("danger");
    expect(v.isLive).toBe(false);
  });

  it("ending precedes processing (both non-live)", () => {
    const endingView = deriveLifecycle({
      persistedStatus: "ending",
      sessionEndedAt: "2026-07-19T10:00:00Z",
      reconciledAt: null,
      clientStatus: "disconnected",
    });
    const processingView = deriveLifecycle({
      persistedStatus: "processing",
      sessionEndedAt: "2026-07-19T10:00:00Z",
      reconciledAt: null,
      clientStatus: "disconnected",
    });
    expect(endingView.phase).toBe("ending");
    expect(processingView.phase).toBe("processing");
    expect(endingView.isLive).toBe(false);
    expect(processingView.isLive).toBe(false);
  });
});

describe("labelTranscriptSource", () => {
  it("labels webhook and fallback distinctly", () => {
    expect(labelTranscriptSource("webhook")).toBe("Webhook received");
    expect(labelTranscriptSource("fallback")).toBe("Transcript fetched");
  });
  it("returns 'Not available' for missing sources", () => {
    expect(labelTranscriptSource(null)).toBe("Not available");
    expect(labelTranscriptSource(undefined)).toBe("Not available");
    expect(labelTranscriptSource("none")).toBe("Not available");
  });
});
