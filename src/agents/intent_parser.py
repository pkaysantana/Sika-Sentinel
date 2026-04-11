"""
Intent Parser — converts a natural-language payout instruction into an Action.

Uses the Hedera Agent Kit (LangChain toolchain) to extract structured fields
from free-form operator input.  The model interprets intent; the downstream
policy engine decides whether the action is permitted.

Primary path:  hedera-agent-kit + LangChain structured output
Fallback path: regex / keyword extraction for hackathon resilience
"""

from __future__ import annotations

from src.schemas.action import Action


def parse_instruction(raw_instruction: str, actor_id: str) -> Action:
    """
    Parse a natural-language payout instruction into a structured Action.

    Args:
        raw_instruction: Free-form operator input, e.g.
            "Send 5 HBAR to approved partner wallet 0.0.800"
        actor_id: Hedera account ID of the requesting actor (from session context).

    Returns:
        A fully-populated Action ready for context loading and policy evaluation.

    Raises:
        ValueError: If the instruction cannot be parsed into a valid Action.
    """
    raise NotImplementedError
