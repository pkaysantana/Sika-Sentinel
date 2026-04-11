"""
Context Engine — loads policy-relevant state for an Action.

Supplies the clearance engine with everything it needs to evaluate the action:
  - actor role and permissions
  - approved recipient list
  - per-actor and global amount thresholds
  - current treasury posture (NORMAL | RESTRICTED | FROZEN)

For the MVP the context store is a local JSON file seeded by scripts/seed_context.py.
Post-hackathon this will be replaced by a database-backed service.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class TreasuryPosture(str, Enum):
    NORMAL = "NORMAL"
    RESTRICTED = "RESTRICTED"
    FROZEN = "FROZEN"


class ActorRole(str, Enum):
    OPERATOR = "OPERATOR"
    PARTNER = "PARTNER"
    ADMIN = "ADMIN"


@dataclass
class PolicyContext:
    """All policy-relevant state for a single action evaluation."""

    actor_id: str
    actor_role: ActorRole
    amount_threshold_hbar: float          # maximum single-transfer amount for this actor
    approved_recipients: list[str] = field(default_factory=list)
    treasury_posture: TreasuryPosture = TreasuryPosture.NORMAL


def load_context(actor_id: str, recipient_id: str) -> PolicyContext:
    """
    Load policy context for the given actor and recipient.

    Args:
        actor_id:    Hedera account ID of the requesting actor.
        recipient_id: Hedera account ID of the intended recipient.

    Returns:
        A PolicyContext populated from the local context store.

    Raises:
        KeyError: If the actor_id is not found in the context store.
    """
    raise NotImplementedError
