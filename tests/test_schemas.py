"""
Smoke tests for Pydantic schema construction.
These run immediately — no external dependencies required.
"""

from src.schemas.action import Action, ActionType
from src.schemas.policy import Decision, DenialReason, PolicyResult
from src.schemas.audit import AuditMessage


def test_action_defaults():
    action = Action(
        action_type=ActionType.HBAR_TRANSFER,
        actor_id="0.0.100",
        recipient_id="0.0.800",
        amount_hbar=5.0,
        raw_instruction="Send 5 HBAR to 0.0.800",
    )
    assert action.correlation_id != ""
    assert action.memo == ""


def test_policy_result_approved():
    result = PolicyResult(decision=Decision.APPROVED)
    assert result.denial_reason is None


def test_policy_result_denied():
    result = PolicyResult(
        decision=Decision.DENIED,
        denial_reason=DenialReason.RECIPIENT_NOT_APPROVED,
        denial_detail="Recipient 0.0.999 is not on the approved list.",
    )
    assert result.denial_reason == DenialReason.RECIPIENT_NOT_APPROVED


def test_audit_message_construction():
    action = Action(
        action_type=ActionType.HBAR_TRANSFER,
        actor_id="0.0.100",
        recipient_id="0.0.800",
        amount_hbar=5.0,
        raw_instruction="Send 5 HBAR to 0.0.800",
    )
    result = PolicyResult(decision=Decision.APPROVED)
    msg = AuditMessage(correlation_id=action.correlation_id, action=action, policy_result=result)
    assert msg.tx_id == ""
    assert msg.sequence_number == -1
