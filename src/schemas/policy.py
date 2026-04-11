"""
PolicyResult — the output of the clearance engine.

Carries the decision (APPROVED / DENIED / ESCALATED) and, for denials,
a structured reason that is safe to surface in the UI and audit trail.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class Decision(str, Enum):
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    ESCALATED = "ESCALATED"


class DenialReason(str, Enum):
    ACTOR_NOT_AUTHORISED = "ACTOR_NOT_AUTHORISED"
    RECIPIENT_NOT_APPROVED = "RECIPIENT_NOT_APPROVED"
    AMOUNT_EXCEEDS_THRESHOLD = "AMOUNT_EXCEEDS_THRESHOLD"
    TREASURY_RESTRICTED = "TREASURY_RESTRICTED"
    TREASURY_FROZEN = "TREASURY_FROZEN"


class PolicyResult(BaseModel):
    """Output of the deterministic clearance engine."""

    decision: Decision
    denial_reason: DenialReason | None = None
    denial_detail: str = ""       # human-readable explanation for UI / logs
    evaluated_rules: list[str] = []   # ordered list of rule IDs checked
