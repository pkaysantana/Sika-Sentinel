"""
Pipeline orchestrator — wires the full Sentinel flow together.

Called by the demo UI (app/demo.py) and the CLI entrypoint (main.py).

Flow:
  parse_instruction → load_context → evaluate → [execute_transfer] → record
"""

from __future__ import annotations

from src.agents.intent_parser import parse_instruction
from src.audit import trail
from src.context.loader import load_context
from src.hedera import transfer
from src.policy import engine
from src.schemas.audit import AuditMessage
from src.schemas.policy import Decision


def run(raw_instruction: str, actor_id: str) -> AuditMessage:
    """
    Run the full governed payout pipeline for one instruction.

    Args:
        raw_instruction: Natural-language operator input.
        actor_id:        Hedera account ID of the requesting actor.

    Returns:
        The submitted AuditMessage (contains action, policy result, tx_id, HCS ref).
    """
    action = parse_instruction(raw_instruction, actor_id)
    context = load_context(action.actor_id, action.recipient_id)
    policy_result = engine.evaluate(action, context)

    tx_id = ""
    if policy_result.decision == Decision.APPROVED:
        tx_id = transfer.execute_transfer(action)

    return trail.record(action, policy_result, tx_id)
