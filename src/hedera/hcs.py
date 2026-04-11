"""
Hedera Consensus Service client.

Provides two capabilities:
  - submit_message: write an AuditMessage to the configured HCS topic
  - fetch_messages: read the ordered message history from the mirror node
                    (used by the audit replay UI)

Topic ID is read from HCS_TOPIC_ID in the environment.
"""

from __future__ import annotations

from src.schemas.audit import AuditMessage


def submit_message(audit_message: AuditMessage) -> AuditMessage:
    """
    Serialise and submit an AuditMessage to the HCS audit topic.

    Populates audit_message.topic_id and audit_message.sequence_number
    from the network response before returning.

    Args:
        audit_message: The evidence record to submit.

    Returns:
        The same AuditMessage with topic_id and sequence_number filled in.

    Raises:
        RuntimeError: If the HCS submission fails.
    """
    raise NotImplementedError


def fetch_messages(topic_id: str, limit: int = 100) -> list[AuditMessage]:
    """
    Fetch ordered AuditMessages from the Hedera mirror node for audit replay.

    Args:
        topic_id: The HCS topic ID to query (e.g. "0.0.XXXXX").
        limit:    Maximum number of messages to return (most recent first).

    Returns:
        List of AuditMessages ordered by HCS sequence number ascending.

    Raises:
        RuntimeError: If the mirror node query fails.
    """
    raise NotImplementedError
