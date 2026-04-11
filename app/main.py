"""
Demo frontend entry point.
Lightweight web server (FastAPI) that exposes the operator UI:
  POST /instruct  — submit a natural-language payout instruction
  GET  /audit     — fetch ordered HCS audit history
  GET  /          — serve the demo HTML shell
"""
