/**
 * Shared types, constants, and pure utilities for the dashboard.
 * No React imports — safe to use in both client and server components.
 */

// ── Domain types ──────────────────────────────────────────────────────────────

export type Instruction = { label: string; text: string; tag: string; tagClass: string };

export type ScenarioKey = "remittance" | "ngo" | "sme" | "sikahub";

export interface Scenario {
  label: string;
  description: string;
  actorLabel: string;
  partnerLabel: string;
  icon: string;
  instructions: Instruction[];
}

export type DecisionBadge = { label: string; className: string };

export interface ApprovalResult {
  status: string;
  signTxId: string;
  executionTxId: string;
  scheduleId: string;
  hcsTopicId?: string;
  hcsSequenceNumber?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEMO_ACTOR_ID = "0.0.8570111";

const APPROVED = { tag: "APPROVED",     tagClass: "bg-green-950 text-green-400"  };
const APPROVAL = { tag: "APPROVAL REQ", tagClass: "bg-yellow-950 text-yellow-400" };
const DENIED   = { tag: "DENIED",       tagClass: "bg-red-950 text-red-400"       };
const BALANCE  = { tag: "BALANCE",      tagClass: "bg-[#0c0a1a] text-[#b47aff]"  };
const BLOCKED  = { tag: "BLOCKED",      tagClass: "bg-amber-950 text-amber-400"   };

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  remittance: {
    label: "Remittance operator payout",
    description: "Governed payout from a remittance operator to an approved corridor partner.",
    actorLabel: "Remittance Operator",
    partnerLabel: "Corridor Partner",
    icon: "↗",
    instructions: [
      { label: "Small payout — approved",          text: "Send 5 HBAR to 0.0.8598115",   ...APPROVED },
      { label: "Unapproved wallet — denied",        text: "Send 5 HBAR to 0.0.9999999",   ...DENIED   },
      { label: "High-value — approval required",    text: "Send 200 HBAR to 0.0.8598115", ...APPROVAL },
      { label: "Balance check",                     text: "Check treasury balance",        ...BALANCE  },
      { label: "Vague — clarification needed",      text: "Send money to partner",         ...BLOCKED  },
    ],
  },
  ngo: {
    label: "NGO / aid disbursement",
    description: "Controlled disbursement to an approved field partner with full audit evidence.",
    actorLabel: "NGO Treasury",
    partnerLabel: "Field Partner",
    icon: "🤝",
    instructions: [
      { label: "Small disbursement — approved",     text: "Release 5 HBAR to 0.0.8598115",    ...APPROVED },
      { label: "Unknown wallet — denied",           text: "Release 5 HBAR to 0.0.9999999",    ...DENIED   },
      { label: "Large disbursement — approval req", text: "Release 200 HBAR to 0.0.8598115",  ...APPROVAL },
      { label: "Balance check",                     text: "Check disbursement wallet balance", ...BALANCE  },
      { label: "Vague — clarification needed",      text: "Send funds urgently",               ...BLOCKED  },
    ],
  },
  sme: {
    label: "SME treasury payment",
    description: "Governed treasury payment to an approved vendor or supplier.",
    actorLabel: "SME Treasury",
    partnerLabel: "Vendor / Supplier",
    icon: "🏢",
    instructions: [
      { label: "Vendor payment — approved",         text: "Pay 5 HBAR to 0.0.8598115",   ...APPROVED },
      { label: "Unapproved vendor — denied",        text: "Pay 5 HBAR to 0.0.9999999",   ...DENIED   },
      { label: "Large payment — approval required", text: "Pay 200 HBAR to 0.0.8598115", ...APPROVAL },
      { label: "Balance check",                     text: "Check treasury balance",       ...BALANCE  },
      { label: "Vague — clarification needed",      text: "Pay supplier",                 ...BLOCKED  },
    ],
  },
  sikahub: {
    label: "SikaHub partner corridor",
    description: "Governed payout in a SikaHub-style Ghana / diaspora partner payment flow.",
    actorLabel: "SikaHub Operator",
    partnerLabel: "Corridor Wallet",
    icon: "🌍",
    instructions: [
      { label: "Corridor payout — approved",        text: "Send 5 HBAR to 0.0.8598115",      ...APPROVED },
      { label: "Unapproved corridor — denied",      text: "Send 5 HBAR to 0.0.9999999",      ...DENIED   },
      { label: "High-value — approval required",    text: "Send 200 HBAR to 0.0.8598115",    ...APPROVAL },
      { label: "Balance check",                     text: "Check corridor treasury balance",  ...BALANCE  },
      { label: "Vague — clarification needed",      text: "Send payout now",                 ...BLOCKED  },
    ],
  },
};

// ── Pure utilities ────────────────────────────────────────────────────────────

export function getBadge(decision?: string): DecisionBadge {
  switch (decision) {
    case "APPROVED":          return { label: "APPROVED",          className: "bg-green-950 text-green-400"  };
    case "DENIED":            return { label: "DENIED",            className: "bg-red-950 text-red-400"      };
    case "APPROVAL_REQUIRED": return { label: "APPROVAL REQUIRED", className: "bg-yellow-950 text-yellow-400"};
    case "MANUAL_REVIEW":     return { label: "MANUAL REVIEW",     className: "bg-orange-950 text-orange-400"};
    default:                  return { label: decision ?? "UNKNOWN", className: "bg-gray-900 text-gray-400"  };
  }
}
