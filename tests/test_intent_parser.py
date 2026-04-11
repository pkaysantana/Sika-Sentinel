"""
Tests for the intent parser.

Validates that natural-language instructions are correctly parsed into
structured Action objects with the right fields.
"""

import pytest

from src.schemas.action import ActionType


@pytest.mark.skip(reason="parser not yet implemented")
def test_parses_basic_transfer():
    from src.agents.intent_parser import parse_instruction
    action = parse_instruction("Send 5 HBAR to approved partner wallet 0.0.800", "0.0.100")
    assert action.action_type == ActionType.HBAR_TRANSFER
    assert action.amount_hbar == 5.0
    assert action.recipient_id == "0.0.800"
    assert action.actor_id == "0.0.100"
    assert action.raw_instruction != ""


@pytest.mark.skip(reason="parser not yet implemented")
def test_parse_failure_raises():
    from src.agents.intent_parser import parse_instruction
    with pytest.raises(ValueError):
        parse_instruction("do something vague", "0.0.100")
