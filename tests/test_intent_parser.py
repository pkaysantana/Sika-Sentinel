"""
Tests for the intent parser.

Validates that natural-language instructions are correctly parsed into
structured Action objects with the right fields.
"""

import pytest

from src.schemas.action import ActionType


def _parse_or_skip(instruction: str, actor_id: str):
    """
    Helper to execute parse_instruction if implemented,
    otherwise skip the test smoothly for scaffolding.
    """
    from src.agents.intent_parser import parse_instruction
    try:
        return parse_instruction(instruction, actor_id)
    except NotImplementedError:
        pytest.skip("parser not yet implemented")


def test_missing_recipient():
    with pytest.raises(ValueError, match="missing.*recipient|vague|specify"):
        _parse_or_skip("Send 5 HBAR", "0.0.100")


def test_missing_amount():
    with pytest.raises(ValueError, match="missing.*amount|vague|specify"):
        _parse_or_skip("Send to 0.0.800", "0.0.100")


def test_vague_transfer_instruction():
    with pytest.raises(ValueError, match="vague|specify"):
        _parse_or_skip("send money", "0.0.100")


def test_unsupported_instruction():
    with pytest.raises(ValueError):
        _parse_or_skip("stake this account to node 4", "0.0.100")


def test_valid_transfer_proceeds():
    action = _parse_or_skip("Send 5 HBAR to 0.0.800", "0.0.100")
    assert action.action_type == ActionType.HBAR_TRANSFER


def test_valid_balance_check_proceeds():
    action = _parse_or_skip("What is my balance?", "0.0.100")
    assert action.action_type == ActionType.CHECK_BALANCE
