import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ChromeSession } from "./chrome.js";
import { JevClient } from "./jev.js";
import { runAgent } from "./agent.js";

function argumentsForRun(args: string[]): { task: string; startUrl?: string; values: Record<string, string>; maxSteps: number } {
  const parts: string[] = [];
  const values: Record<string, string> = {};
  let startUrl: string | undefined;
  let maxSteps = 30;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--start") { startUrl = args[++index]; continue; }
    if (arg === "--max-steps") { maxSteps = Number(args[++index]); continue; }
    if (arg === "--value") {
      const pair = args[++index] ?? "";
      const equals = pair.indexOf("=");
      if (equals < 1) throw new Error("--value requires Label=exact text");
      values[pair.slice(0, equals)] = pair.slice(equals + 1);
      continue;
    }
    parts.push(arg);
  }
  const task = parts.join(" ").trim();
  if (!task) throw new Error("Provide a task as an argument.");
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw new Error("--max-steps must be 1-100.");
  return { task, ...(startUrl ? { startUrl } : {}), values, maxSteps };
}

const key = process.env.TYPESAFE_API_KEY;
if (!key) {
  console.error("Set TYPESAFE_API_KEY before starting the agent.");
  process.exitCode = 1;
} else {
  const input = createInterface({ input: stdin, output: stdout });
  let chrome = new ChromeSession();
  try {
    const args = argumentsForRun(process.argv.slice(2));
    console.log("Requesting access to your open Chrome session. Approve Chrome's connection prompt.");
    try {
      await chrome.connect();
    } catch {
      const answer = await input.question("In Chrome, enable remote debugging at chrome://inspect/#remote-debugging. Press Enter to retry, or type stop: ");
      if (answer.trim().toLowerCase() === "stop") throw new Error("Chrome connection was not enabled.");
      chrome = new ChromeSession();
      console.log("Requesting access again. Approve Chrome's connection prompt.");
      await chrome.connect();
    }
    const result = await runAgent(chrome, new JevClient(key), {
      ...args,
      ask: (message) => input.question(message),
      log: (message) => console.log(message),
    });
    console.log(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await chrome.close();
    input.close();
  }
}
