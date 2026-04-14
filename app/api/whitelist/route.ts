/**
 * GET  /api/whitelist?actorId=...  — return current approved recipients
 * POST /api/whitelist              — add a recipient to an actor's approved list
 *   Body: { actorId: string; recipientId: string }
 *
 * POST response includes `alreadyExisted: boolean` so callers can distinguish
 * between a new addition and a no-op duplicate.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  addApprovedRecipient,
  getApprovedRecipients,
} from "../../../src/context/loader";
import { whitelistLimiter } from "../../../src/middleware/limiters";

/** Hedera account ID: shard.realm.num (all numeric segments). */
const HEDERA_ID_RE = /^\d+\.\d+\.\d+$/;

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!whitelistLimiter.allow(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const actorId = req.nextUrl.searchParams.get("actorId");
  if (!actorId) {
    return NextResponse.json({ error: "actorId query param is required" }, { status: 400 });
  }
  try {
    const recipients = getApprovedRecipients(actorId);
    return NextResponse.json({ actorId, recipients });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    );
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!whitelistLimiter.allow(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { actorId?: string; recipientId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { actorId, recipientId } = body;
  if (!actorId || typeof actorId !== "string") {
    return NextResponse.json({ error: "actorId is required" }, { status: 400 });
  }
  if (!recipientId || typeof recipientId !== "string") {
    return NextResponse.json({ error: "recipientId is required" }, { status: 400 });
  }

  const trimmedRecipient = recipientId.trim();
  if (!HEDERA_ID_RE.test(trimmedRecipient)) {
    return NextResponse.json(
      { error: `'${recipientId}' is not a valid Hedera account ID (expected shard.realm.num)` },
      { status: 400 }
    );
  }

  try {
    const { alreadyExisted } = await addApprovedRecipient(actorId, trimmedRecipient);
    const recipients = getApprovedRecipients(actorId);
    return NextResponse.json({ actorId, recipients, alreadyExisted });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    );
  }
}
