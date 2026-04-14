/**
 * GET /api/audit/replay
 * Returns last 50 AuditMessages from HCS for the configured topic.
 *
 * Responses are cached in memory for 30 seconds per topic ID to avoid
 * hammering the Mirror Node on every UI refresh.
 */

import { NextResponse } from "next/server";
import { replay } from "../../../../src/audit/trail";
import type { AuditMessage } from "../../../../src/schemas/audit";

// ── 30-second TTL cache ───────────────────────────────────────────────────────

const TTL_MS = 30_000;

interface CacheEntry {
  messages: AuditMessage[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(topicId: string): AuditMessage[] | null {
  const entry = cache.get(topicId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.messages;
}

function setCached(topicId: string, messages: AuditMessage[]): void {
  cache.set(topicId, { messages, expiresAt: Date.now() + TTL_MS });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  const topicId = process.env.HCS_TOPIC_ID;
  if (!topicId || topicId === "0.0.XXXXXX") {
    return NextResponse.json({ messages: [], configured: false });
  }

  const cached = getCached(topicId);
  if (cached) {
    return NextResponse.json({ messages: cached, configured: true });
  }

  try {
    const messages = await replay(50);
    setCached(topicId, messages);
    return NextResponse.json({ messages, configured: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
