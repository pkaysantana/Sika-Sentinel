"""
Hedera Execution Adapter — HBAR transfer.

Called ONLY for APPROVED actions.  Executes a transfer via the Hedera Agent Kit
(primary) or Hiero CLI (fallback) and returns the Hedera transaction ID.

Never called directly from outside the sentinel pipeline — always gated by the
policy engine result.
"""

from __future__ import annotations

from src.schemas.action import Action


def execute_transfer(action: Action) -> str:
    """
    Execute an HBAR transfer on Hedera testnet for an approved action.

    Args:
        action: The approved Action to execute.  amount_hbar and recipient_id
                must be set.

    Returns:
        The Hedera transaction ID string, e.g. "0.0.XXXXX@1234567890.000000000".

    Raises:
        RuntimeError: If the transfer fails or is rejected by the network.
    """
    raise NotImplementedError
