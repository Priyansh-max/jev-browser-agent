import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

interface SessionFile { port: number; token: string; pid: number; expiresAt: number }
interface Health { connection: "connecting" | "ready" | "error"; connectionError: string; connectionMs: number; expiresAt: string; activeRun: string | null }
interface RunEvent { index: number; type: "log" | "prompt" | "result" | "error"; message: string }

const sessionPath = resolve(".runtime/session.json");

async function sessionFile(): Promise<SessionFile | undefined> {
  try { return JSON.parse(await readFile(sessionPath, "utf8")) as SessionFile; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function request<T>(session: SessionFile, path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${session.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.token}`, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `Session HTTP ${response.status}`);
  return result;
}

async function readySession(): Promise<SessionFile> {
  let existing = await sessionFile();
  if (existing) {
    try {
      const health = await request<Health>(existing, "/health");
      if (health.connection === "ready") return existing;
      if (health.connection === "error") throw new Error(health.connectionError);
    } catch (error) {
      if (error instanceof Error && !/fetch failed|ECONNREFUSED|ETIMEDOUT/.test(error.message)) throw error;
      await rm(sessionPath, { force: true });
      existing = undefined;
    }
  }
  if (!existing) {
    const child = spawn(process.execPath, ["--env-file-if-exists=.env", "--import", "tsx", "src/session-server.ts"], {
      cwd: resolve("."), detached: true, windowsHide: true, stdio: "ignore",
    });
    child.unref();
    console.log("Starting one-hour Chrome session...");
  }
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((done) => setTimeout(done, 500));
    const session = await sessionFile();
    if (!session) continue;
    try {
      const health = await request<Health>(session, "/health");
      if (health.connection === "ready") {
        console.log(`Chrome connected in ${health.connectionMs} ms; session expires ${health.expiresAt}.`);
        return session;
      }
      if (health.connection === "error") throw new Error(health.connectionError);
    } catch (error) {
      if (error instanceof Error && /fetch failed|ECONNREFUSED|ETIMEDOUT/.test(error.message)) continue;
      throw error;
    }
  }
  throw new Error("Chrome connection did not become ready within one minute. Check Chrome's permission prompt.");
}

function parseRun(args: string[]): { task: string; startUrl?: string; pageId?: number; values: Record<string, string>; maxSteps: number } {
  const parts: string[] = [];
  const values: Record<string, string> = {};
  let startUrl: string | undefined;
  let pageId: number | undefined;
  let maxSteps = 30;
  for (let index = 0; index < args.length; index++) {
    const part = args[index]!;
    if (part === "--start") { startUrl = args[++index]; continue; }
    if (part === "--tab") { pageId = Number(args[++index]); continue; }
    if (part === "--max-steps") { maxSteps = Number(args[++index]); continue; }
    if (part === "--value") {
      const pair = args[++index] ?? "";
      const equals = pair.indexOf("=");
      if (equals < 1) throw new Error("--value requires Label=exact text");
      values[pair.slice(0, equals)] = pair.slice(equals + 1);
      continue;
    }
    parts.push(part);
  }
  const task = parts.join(" ").trim();
  if (!task) throw new Error("Provide a task.");
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw new Error("--max-steps must be 1-100.");
  if (pageId !== undefined && (!Number.isInteger(pageId) || pageId < 1)) throw new Error("--tab requires a positive tab ID.");
  return { task, ...(startUrl ? { startUrl } : {}), ...(pageId ? { pageId } : {}), values, maxSteps };
}

async function watch(session: SessionFile, id: string): Promise<void> {
  let after = -1;
  while (true) {
    const state = await request<{ status: "running" | "done"; awaitingAnswer: boolean; events: RunEvent[] }>(session, `/runs/${encodeURIComponent(id)}?after=${after}`);
    for (const item of state.events) {
      after = item.index;
      console.log(item.message);
      if (item.type === "prompt" && state.awaitingAnswer) {
        console.log(`Awaiting chat reply. Run ID: ${id}. Reply with: npm run chat -- answer ${id}`);
        return;
      }
    }
    if (state.status === "done") return;
    await new Promise((done) => setTimeout(done, 300));
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "start") {
    await readySession();
  } else if (command === "run") {
    const options = parseRun(args);
    const session = await readySession();
    const result = await request<{ id: string }>(session, "/runs", "POST", options);
    console.log(`Run ID: ${result.id}`);
    await watch(session, result.id);
  } else if (command === "tabs") {
    const session = await readySession();
    const tabs = await request<Array<{ id: number; url: string; selected: boolean }>>(session, "/tabs");
    for (const tab of tabs) console.log(tab.id + ": " + tab.url + (tab.selected ? " [selected]" : ""));
  } else if (command === "watch") {
    if (!args[0]) throw new Error("Provide a run ID.");
    const session = await sessionFile();
    if (!session) throw new Error("No active session.");
    await watch(session, args[0]);
  } else if (command === "answer") {
    if (!args[0]) throw new Error("Provide a run ID.");
    const session = await sessionFile();
    if (!session) throw new Error("No active session.");
    const chunks: Buffer[] = [];
    if (args[1] === undefined) for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const answer = args[1] ?? Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");
    await request(session, `/runs/${encodeURIComponent(args[0])}/answer`, "POST", { answer });
    console.log("Answer sent.");
  } else if (command === "status") {
    const session = await sessionFile();
    console.log(session ? await request<Health>(session, "/health") : "No active session.");
  } else if (command === "reconnect") {
    const session = await sessionFile();
    if (!session) throw new Error("No session to reconnect.");
    console.log(await request(session, "/connect", "POST"));
  } else if (command === "stop") {
    const session = await sessionFile();
    if (!session) return;
    await request(session, "/stop", "POST");
    console.log("Session stopped.");
  } else {
    throw new Error("Use: chat start | tabs | run [--tab id] <task> | watch <run-id> | answer <run-id> | status | reconnect | stop");
  }
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
