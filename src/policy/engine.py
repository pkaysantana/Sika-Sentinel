"""
Policy / Clearance Engine — deterministic rule evaluation.

Receives a structured Action and its loaded PolicyContext, applies an ordered
set of rules, and returns a PolicyResult (APPROVED / DENIED / ESCALATED).

Design principle: the model interprets intent; this module decides whether
money moves.  All rules are explicit, logged, and auditable.

Rule evaluation order (first failure short-circuits):
  1. ACTOR_AUTHORISED      — actor role must be OPERATOR or PARTNER
  2. RECIPIENT_APPROVED    — recipient must be on the actor's approved list
  3. AMOUNT_WITHIN_LIMIT   — transfer amount must not exceed actor threshold
  4. TREASURY_POSTURE      — treasury must not be RESTRICTED or FROZEN
"""

from __future__ import annotations

from src.context.loader import PolicyContext
from src.schemas.action import Action
from src.schemas.policy import Decision, DenialReason, PolicyResult


def evaluate(action: Action, context: PolicyContext) -> PolicyResult:
    """
    Apply deterministic clearance rules to the action.

    Args:
        action:  The structured payout instruction to evaluate.
        context: Policy-relevant state loaded for this action.

    Returns:
        A PolicyResult with decision and, on denial, a structured reason.
    """
    raise NotImplementedError
