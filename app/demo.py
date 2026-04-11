"""
Sika Sentinel — Streamlit demo UI.

Three-panel layout matching the demo script in the PRD:
  1. Instruction input  — operator submits a natural-language payout instruction
  2. Decision panel     — shows APPROVED / DENIED + reason in real time
  3. Audit replay       — ordered HCS event history with HashScan link

Run with:
    streamlit run app/demo.py
"""

from __future__ import annotations

import streamlit as st

# ── page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Sika Sentinel",
    page_icon="🛡️",
    layout="wide",
)

st.title("🛡️ Sika Sentinel")
st.caption("Runtime governance and evidence layer for delegated financial action on Hedera")

# ── sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.header("Actor")
    actor_id = st.text_input("Hedera Account ID", value="0.0.XXXXXX")
    st.caption("Identifies the operator submitting the instruction.")

# ── panel 1: instruction input ────────────────────────────────────────────────
st.subheader("1  Submit Instruction")

instruction = st.text_area(
    "Natural-language payout instruction",
    placeholder='e.g. "Send 5 HBAR to approved partner wallet 0.0.800"',
    height=80,
)

submit = st.button("Evaluate & Execute", type="primary", disabled=not instruction.strip())

# ── panel 2: decision ─────────────────────────────────────────────────────────
st.subheader("2  Decision")

if submit and instruction.strip():
    with st.spinner("Parsing → policy → execution → audit…"):
        # TODO: wire up pipeline.run(instruction, actor_id)
        st.info("Pipeline not yet wired. Implement pipeline.run() in app/pipeline.py.")
else:
    st.caption("Submit an instruction above to see the policy decision.")

# ── panel 3: audit replay ─────────────────────────────────────────────────────
st.subheader("3  Audit Replay")

if st.button("Refresh audit trail"):
    with st.spinner("Fetching HCS messages…"):
        # TODO: wire up audit.trail.replay()
        st.info("Audit replay not yet wired. Implement src/audit/trail.py::replay().")

st.caption("Each entry is an immutable HCS message. Verify independently on HashScan.")
