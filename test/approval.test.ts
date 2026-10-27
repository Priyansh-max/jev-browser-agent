import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalReason } from "../src/approval.js";

test("asks before sensitive form entry and consequential clicks", () => {
  assert.match(approvalReason({ key: "a", uid: "1_1", role: "textbox", description: 'textbox "Email address"' }) ?? "", /sensitive data/);
  assert.match(approvalReason({ key: "b", uid: "1_2", role: "button", description: 'button "Share document"' }) ?? "", /change data/);
  assert.equal(approvalReason({ key: "c", uid: "1_3", role: "link", description: 'link "View orders"' }), undefined);
});
