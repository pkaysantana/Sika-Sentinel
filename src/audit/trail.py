"""
Audit Trail — evidence layer orchestrator.

Composes an AuditMessage from a completed pipeline run (action + policy result +
optional tx_id) and dispatches it to HCS.  Also exposes audit replay for the UI.

Called after every decision — APPROVED and DENIED alike.
"""

from __future__ import annotations

from src.hedera import hcs
from src.schemas.action import Action
from src.schemas.audit import AuditMessage
from src.schemas.policy import PolicyResult


def record(
    action: Action,
    policy_result: PolicyResult,
    tx_id: str = "",
) -> AuditMessage:
    """
    Build an AuditMessage and write it to HCS.

    Args:
        action:        The evaluated Action.
        policy_result: The clearance engine output.
        tx_id:         Hedera transaction ID (non-empty only on APPROVED path).

    Returns:
        The submitted AuditMessage with HCS sequence number populated.
    """
    raise NotImplementedError


def replay(limit: int = 50) -> list[AuditMessage]:
    """
    Return the ordered HCS audit history for the demo audit replay view.

    Args:
        limit: Maximum number of entries to return.

    Returns:
        AuditMessages in HCS sequence order (oldest first).
    """
    raise NotImplementedError
