import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgent } from "../src/agent.js";
import type { ChromeSession, PageInfo } from "../src/chrome.js";
import type { JevClient } from "../src/jev.js";

const header = 'uid=1_0 RootWebArea "Song - YouTube" url="https://www.youtube.com/watch?v=abc"\n';
const ad = header + [
  '  uid=1_1 generic "YouTube Video Player"',
  '    uid=1_2 "Sponsored"',
  '    uid=1_3 button "Skip"',
  '    uid=1_4 slider "Seek slider" disableable disabled',
  '    uid=1_5 button "Pause keyboard shortcut k"',
].join("\n");
const video = header + [
  '  uid=2_1 generic "YouTube Video Player"',
  '    uid=2_2 slider "Seek slider" value="4" valuemax="240"',
  '    uid=2_3 button "Pause keyboard shortcut k"',
].join("\n");

test("skips a YouTube ad and verifies actual playback without another JEV call", async () => {
  let current = ad;
  const clicked: string[] = [];
  const pages: PageInfo[] = [{ id: 1, url: "https://www.youtube.com/watch?v=abc", selected: true }];
  const chrome = {
    open: async () => 1,
    pages: async () => pages,
    snapshot: async () => current,
    click: async (_pageId: number, uid: string) => { clicked.push(uid); current = video; },
  } as unknown as ChromeSession;
  const jev = { decide: async () => { throw new Error("JEV should not be needed for ad handling or playback verification."); } } as unknown as JevClient;
  const result = await runAgent(chrome, jev, {
    task: "Open https://www.youtube.com/watch?v=abc and play the song",
    values: {},
    maxSteps: 1,
    ask: async () => "",
    log: () => {},
  });
  assert.deepEqual(clicked, ["1_3"]);
  assert.match(result, /^Verified YouTube playback:/);
});
