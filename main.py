"""
Sika Sentinel — CLI entry point.

For the hackathon demo, the primary UI is the Streamlit app:
    streamlit run app/demo.py

This file exists as a quick smoke-test runner and for non-UI invocations.

Usage:
    python main.py "Send 5 HBAR to approved partner wallet 0.0.800" --actor 0.0.100
"""

from __future__ import annotations

import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Sika Sentinel — governed payout pipeline")
    parser.add_argument("instruction", help="Natural-language payout instruction")
    parser.add_argument("--actor", required=True, help="Hedera account ID of the requesting actor")
    args = parser.parse_args()

    # Import here so env vars are loaded before any Hedera SDK init
    from dotenv import load_dotenv
    load_dotenv()

    from app.pipeline import run
    result = run(args.instruction, args.actor)
    print(json.dumps(result.model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    main()
