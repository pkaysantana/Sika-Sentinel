"""
Tests for the deterministic policy / clearance engine.

Covers the four rule categories defined in src/policy/engine.py:
  - actor authorisation
  - recipient approval
  - amount threshold
  - treasury posture
"""

import pytest

from src.context.loader import ActorRole, PolicyContext, TreasuryPosture
from src.schemas.action import Action, ActionType
from src.schemas.policy import Decision, DenialReason


# ── fixtures ──────────────────────────────────────────────────────────────────

def make_action(**overrides) -> Action:
    defaults = dict(
        action_type=ActionType.HBAR_TRANSFER,
        actor_id="0.0.100",
        recipient_id="0.0.800",
        amount_hbar=5.0,
        raw_instruction="Send 5 HBAR to 0.0.800",
    )
    return Action(**(defaults | overrides))


def make_context(**overrides) -> PolicyContext:
    defaults = dict(
        actor_id="0.0.100",
        actor_role=ActorRole.OPERATOR,
        amount_threshold_hbar=100.0,
        approved_recipients=["0.0.800"],
        treasury_posture=TreasuryPosture.NORMAL,
    )
    return PolicyContext(**(defaults | overrides))


# ── tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.skip(reason="engine not yet implemented")
def test_approved_action():
    from src.policy.engine import evaluate
    result = evaluate(make_action(), make_context())
    assert result.decision == Decision.APPROVED


@pytest.mark.skip(reason="engine not yet implemented")
def test_denied_recipient_not_approved():
    from src.policy.engine import evaluate
    action = make_action(recipient_id="0.0.999")
    result = evaluate(action, make_context())
    assert result.decision == Decision.DENIED
    assert result.denial_reason == DenialReason.RECIPIENT_NOT_APPROVED


@pytest.mark.skip(reason="engine not yet implemented")
def test_denied_amount_exceeds_threshold():
    from src.policy.engine import evaluate
    action = make_action(amount_hbar=999.0)
    result = evaluate(action, make_context(amount_threshold_hbar=10.0))
    assert result.decision == Decision.DENIED
    assert result.denial_reason == DenialReason.AMOUNT_EXCEEDS_THRESHOLD


@pytest.mark.skip(reason="engine not yet implemented")
def test_denied_treasury_frozen():
    from src.policy.engine import evaluate
    context = make_context(treasury_posture=TreasuryPosture.FROZEN)
    result = evaluate(make_action(), context)
    assert result.decision == Decision.DENIED
    assert result.denial_reason == DenialReason.TREASURY_FROZEN
