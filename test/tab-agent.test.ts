import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgent } from "../src/agent.js";
import type { ChromeSession, PageInfo } from "../src/chrome.js";
import type { JevClient } from "../src/jev.js";

test("targets a named existing tab without opening a new one", async () => {
  const observed: number[] = [];
  const pages: PageInfo[] = [
    { id: 1, url: "https://other.example/", selected: true },
    { id: 2, url: "https://example.com/", selected: false },
  ];
  const chrome = {
    pages: async () => pages,
    open: async () => { throw new Error("A new tab must not be opened."); },
    snapshot: async (id: number) => { observed.push(id); return 'uid=1_0 RootWebArea "Example" url="https://example.com/"'; },
  } as unknown as ChromeSession;
  const jev = {
    decide: async () => ({ action: "blocked", confidence: 1, completeProbability: 0, model: "test", latencyMs: 0, inputTokens: 0, outputTokens: 0 }),
  } as unknown as JevClient;
  await runAgent(chrome, jev, {
    task: "Inspect my existing https://example.com/ tab",
    pageId: 2,
    values: {},
    maxSteps: 1,
    ask: async () => "",
    log: () => {},
  });
  assert.deepEqual(observed, [2]);
});
