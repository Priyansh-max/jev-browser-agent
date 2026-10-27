import { ChromeSession } from "./chrome.js";
import { approvalReason } from "./approval.js";
import { JevClient, type Decision } from "./jev.js";
import { inspectYouTubePlayer } from "./media.js";
import { actionsFromSnapshot, needsHuman, searchUrl, taskUrl } from "./snapshot.js";

export interface AgentOptions {
  task: string;
  startUrl?: string;
  values: Record<string, string>;
  maxSteps: number;
  ask: (message: string) => Promise<string>;
  log: (message: string) => void;
  onDecision?: (decision: Decision) => void;
  showMarker?: boolean;
}

function matchingValue(label: string, values: Record<string, string>): string | undefined {
  const normalized = label.toLowerCase();
  return Object.entries(values).find(([key]) => normalized.includes(key.toLowerCase()))?.[1];
}


function isFailurePage(snapshot: string): boolean {
  return /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|This site can.t be reached|page isn.t responding/i.test(snapshot);
}

export async function runAgent(chrome: ChromeSession, jev: JevClient, options: AgentOptions): Promise<string> {
  const { task, ask, log } = options;
  const start = options.startUrl ?? taskUrl(task) ?? searchUrl(task);
  let pageId: number;
  if (start) {
    pageId = await chrome.open(start);
  } else {
    const selected = (await chrome.pages()).find((page) => page.selected);
    if (!selected || /^(chrome:|about:)/.test(selected.url)) {
      throw new Error("Provide a URL in the task or --start. A JEV-only agent cannot safely invent a search query for an unknown site.");
    }
    pageId = selected.id;
  }

  let failures = 0;
  let offset = 0;
  let lastUrl = "";
  const history: string[] = [];
  const markedPages = new Set<number>();
  let adStartedAt: number | undefined;
  let adWaitingLogged = false;
  let mediaSettling = 0;
  try {
    for (let step = 1; step <= options.maxSteps; step++) {
      const pagesBefore = await chrome.pages();
      if (!pagesBefore.some((page) => page.id === pageId)) return "The agent tab was closed.";
      if (options.showMarker) {
        try {
          await chrome.mark(pageId);
          markedPages.add(pageId);
        } catch {
          log("Could not show the agent border on this page.");
        }
      }
      let snapshot = await chrome.snapshot(pageId);
      const pageUrl = pagesBefore.find((page) => page.id === pageId)?.url ?? "";
      if (pageUrl !== lastUrl) {
        offset = 0;
        if (lastUrl) history.push(`Observed browser navigation from ${lastUrl} to ${pageUrl}.`);
      }
      lastUrl = pageUrl;

      const humanReason = needsHuman(snapshot);
      if (humanReason) {
        log(`Paused for ${humanReason} in Chrome.`);
        const reply = await ask("Complete it in Chrome, then press Enter here (or type stop): ");
        if (reply.trim().toLowerCase() === "stop") return "Stopped at a human verification step.";
        snapshot = await chrome.snapshot(pageId);
        if (needsHuman(snapshot)) return "Login or verification remains on the page.";
      }

      if (isFailurePage(snapshot)) {
        if (failures++ >= 1) return "The page still fails to load after one retry.";
        await chrome.navigate(pageId, "reload");
        history.push("Reloaded a failed page once.");
        continue;
      }

      const media = inspectYouTubePlayer(snapshot, task);
      if (media?.ad) {
        adStartedAt ??= Date.now();
        if (Date.now() - adStartedAt > 90_000) return "YouTube's ad did not end within 90 seconds.";
        if (media.skipUid) {
          const fresh = inspectYouTubePlayer(await chrome.snapshot(pageId), task);
          if (fresh?.skipUid) {
            await chrome.click(pageId, fresh.skipUid);
            history.push("Skipped a YouTube ad.");
            log("Skipped a YouTube ad.");
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          if (!adWaitingLogged) log("Waiting for an unskippable YouTube ad.");
          adWaitingLogged = true;
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        step--;
        continue;
      }
      adStartedAt = undefined;
      adWaitingLogged = false;
      if (media?.playing && (history.some((item) => item.startsWith("Clicked link ")) ||
          /\bcurrent\b/i.test(task) || /youtube\.com\/watch\?/.test(start ?? ""))) {
        return "Verified YouTube playback: " + media.title + ". Final page:\n" + snapshot.slice(0, 2500);
      }

      const actions = actionsFromSnapshot(snapshot);
      offset = Math.min(offset, Math.max(0, actions.length - 1));
      const decision = await jev.decide(task, snapshot, actions, offset, history);
      options.onDecision?.(decision);
      log(`Step ${step}: ${decision.action} (confidence ${decision.confidence.toFixed(2)}, complete ${decision.completeProbability.toFixed(2)}, ${decision.model}, ${decision.latencyMs} ms, ${decision.inputTokens} input tokens)`);
      if (decision.completeProbability >= 0.95 && history.length > 0) {
        return `JEV judged the task complete. Verify the final page in Chrome.\n${snapshot.slice(0, 2500)}`;
      }
      if (decision.action === "blocked") {
        if (media && mediaSettling++ < 2) {
          log("Waiting for the YouTube player to settle.");
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          step--;
          continue;
        }
        return `No available action advanced the task. Final page:\n${snapshot.slice(0, 2500)}`;
      }
      mediaSettling = 0;
      if (decision.action === "next_options") { offset += 180; continue; }
      if (decision.action === "previous_options") { offset = Math.max(0, offset - 180); continue; }
      if (decision.action === "wait") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        history.push("Waited one second.");
        continue;
      }
      if (decision.action === "scroll_down" || decision.action === "scroll_up") {
        await chrome.call("press_key", { pageId, key: decision.action === "scroll_down" ? "PageDown" : "PageUp", includeSnapshot: false });
        history.push(decision.action === "scroll_down" ? "Scrolled down." : "Scrolled up.");
        continue;
      }
      if (decision.action === "reload") {
        await chrome.navigate(pageId, "reload");
        history.push("Reloaded page.");
        continue;
      }
      if (decision.action === "press_enter") {
        await chrome.call("press_key", { pageId, key: "Enter", includeSnapshot: false });
        history.push("Submitted focused field with Enter.");
        continue;
      }
      if (decision.action === "go_back") {
        await chrome.navigate(pageId, "back");
        history.push("Went back.");
        continue;
      }

      const selected = actions.find((action) => action.key === decision.action);
      if (!selected) throw new Error("JEV selected an action that is no longer available.");
      const fresh = await chrome.snapshot(pageId);
      const stillPresent = actionsFromSnapshot(fresh).find((action) => action.uid === selected.uid && action.description === selected.description);
      if (!stillPresent) {
        history.push("Page changed before action; observed again.");
        if (++failures >= 3) return "The page changed repeatedly before actions could be executed.";
        continue;
      }

      const approval = approvalReason(selected);
      if (approval) {
        const reply = await ask(`${approval} Type yes to continue: `);
        if (reply.trim().toLowerCase() !== "yes") return "Stopped before a sensitive action.";
      }

      try {
        if (["textbox", "searchbox", "combobox"].includes(selected.role)) {
          let value = matchingValue(selected.description, options.values);
          if (value === undefined) {
            value = await ask(`Exact text for ${selected.description} (blank to stop): `);
            if (!value) return "Stopped: this field requires user-supplied text.";
          }
          await chrome.fill(pageId, selected.uid, value);
          history.push(`Filled ${selected.description}.`);
        } else {

          await chrome.click(pageId, selected.uid);
          history.push(`Clicked ${selected.description}.`);
        }
        failures = 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/dialog/i.test(message)) {
          const reply = await ask("Browser confirmation dialog opened. Type yes to accept, or anything else to dismiss: ");
          await chrome.call("handle_dialog", { pageId, action: reply.trim().toLowerCase() === "yes" ? "accept" : "dismiss" });
          history.push("Handled a browser confirmation dialog.");
        } else {
          history.push(`Action failed: ${message}`);
          if (++failures >= 3) return "Three browser actions failed. Stopped to avoid repeating them.";
        }
      }

      const pagesAfter = await chrome.pages();
      const newPage = pagesAfter.find((page) => !pagesBefore.some((old) => old.id === page.id));
      if (newPage) {
        if (markedPages.has(pageId)) {
          await chrome.unmark(pageId).catch(() => {});
          markedPages.delete(pageId);
        }
        pageId = newPage.id;
        offset = 0;
        history.push("Switched to the newly opened tab.");
      }
    }
    return `Stopped after ${options.maxSteps} steps. The task was not verified complete.`;
  } finally {
    await Promise.allSettled([...markedPages].map((id) => chrome.unmark(id)));
  }
}
