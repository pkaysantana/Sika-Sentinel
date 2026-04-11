"""
Action — the canonical internal representation of a payout instruction.

Created by the intent parser from natural-language input and passed
unchanged through the context engine, policy engine, and audit layer.
"""

from __future__ import annotations

from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field


class ActionType(str, Enum):
    HBAR_TRANSFER = "HBAR_TRANSFER"


class Action(BaseModel):
    """Structured payout instruction produced by the intent parser."""

    correlation_id: str = Field(default_factory=lambda: str(uuid4()))
    action_type: ActionType
    actor_id: str          # Hedera account ID of the requesting actor
    recipient_id: str      # Hedera account ID of the intended recipient
    amount_hbar: float     # Amount in HBAR (not tinybars)
    raw_instruction: str   # Original natural-language input (preserved for audit)
    memo: str = ""
