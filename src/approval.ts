import type { ActionCandidate } from "./snapshot.js";

const CONSEQUENT_ACTION = /\b(delete|remove|submit|send|publish|post|purchase|buy|pay|transfer|place order|confirm|save|share|invite|grant|subscribe|unsubscribe|upload|cancel)\b/i;
const SENSITIVE_FIELD = /\b(email|phone|address|card|payment|ssn|passport|tax|medical|health|password|otp)\b/i;

export function approvalReason(action: ActionCandidate): string | undefined {
  if (["textbox", "searchbox", "combobox"].includes(action.role)) {
    return SENSITIVE_FIELD.test(action.description) ? `Entering ${action.description} may share sensitive data with this site.` : undefined;
  }
  return CONSEQUENT_ACTION.test(action.description) ? `Clicking ${action.description} may change data or send information.` : undefined;
}
