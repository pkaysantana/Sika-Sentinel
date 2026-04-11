"""
PolicyResult — the output of the clearance engine.

Carries the decision and, for non-approved outcomes, a structured reason
that is safe to surface in the demo UI and embedded in the HCS audit trail.

Decision values:
  APPROVED          — action passes all rules; proceed to execution
  DENIED            — action blocked; do not execute
  APPROVAL_REQUIRED — amount exceeds actor threshold; needs human sign-off
  MANUAL_REVIEW     — treasury is RESTRICTED; route to compliance queue
  ESCALATED         — legacy alias kept for backwards compat
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class Decision(str, Enum):
    APPROVED          = "APPROVED"
    DENIED            = "DENIED"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    MANUAL_REVIEW     = "MANUAL_REVIEW"
    ESCALATED         = "ESCALATED"   # backwards-compat alias; prefer APPROVAL_REQUIRED


class DenialReason(str, Enum):
    # Input validation
    MISSING_RECIPIENT        = "MISSING_RECIPIENT"
    INVALID_AMOUNT           = "INVALID_AMOUNT"
    # Actor authorisation
    ACTOR_NOT_AUTHORISED     = "ACTOR_NOT_AUTHORISED"
    # Treasury posture
    TREASURY_FROZEN          = "TREASURY_FROZEN"
    TREASURY_RESTRICTED      = "TREASURY_RESTRICTED"
    # Recipient allowlist
    RECIPIENT_NOT_APPROVED   = "RECIPIENT_NOT_APPROVED"
    # Amount threshold
    AMOUNT_EXCEEDS_THRESHOLD = "AMOUNT_EXCEEDS_THRESHOLD"


class PolicyResult(BaseModel):
    """Output of the deterministic clearance engine."""

    decision: Decision
    denial_reason: DenialReason | None = None
    denial_detail: str = ""
    evaluated_rules: list[str] = []   # rule IDs checked, in evaluation order
