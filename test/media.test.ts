import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectYouTubePlayer } from "../src/media.js";

const header = 'uid=1_0 RootWebArea "Chaiyya Chaiyya - YouTube" url="https://www.youtube.com/watch?v=abc"\n';

test("detects a skippable ad inside the YouTube player", () => {
  const snapshot = header + [
    '  uid=1_1 main',
    '    uid=1_2 generic "YouTube Video Player"',
    '      uid=1_3 "Sponsored"',
    '      uid=1_4 button "Skip"',
    '      uid=1_5 slider "Seek slider" disableable disabled',
    '      uid=1_6 button "Pause keyboard shortcut k"',
    '    uid=1_7 heading "Chaiyya Chaiyya"',
  ].join("\n");
  assert.deepEqual(inspectYouTubePlayer(snapshot, "play Chaiyya Chaiyya"), {
    ad: true, skipUid: "1_4", playing: false, title: "Chaiyya Chaiyya - YouTube",
  });
});

test("verifies video playback without treating a sponsored sidebar as an ad", () => {
  const snapshot = header + [
    '  uid=1_1 main',
    '    uid=1_2 generic "YouTube Video Player"',
    '      uid=1_3 slider "Seek slider" value="4" valuemax="406"',
    '      uid=1_4 button "Pause keyboard shortcut k"',
    '    uid=1_5 heading "Chaiyya Chaiyya"',
    '    uid=1_6 "Sponsored"',
  ].join("\n");
  assert.equal(inspectYouTubePlayer(snapshot, "play Chaiyya Chaiyya")?.playing, true);
  assert.equal(inspectYouTubePlayer(snapshot, "find Chaiyya Chaiyya"), undefined);
});
