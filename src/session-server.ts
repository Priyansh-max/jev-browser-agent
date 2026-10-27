import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { ChromeSession } from "./chrome.js";
import { JevClient, type Decision } from "./jev.js";
import { runAgent, type AgentOptions } from "./agent.js";
import { decisionMetric, saveMetric } from "./metrics.js";

type Event = { index: number; type: "log" | "prompt" | "result" | "error"; message: string };
type Run = {
  id: string;
  events: Event[];
  status: "running" | "done";
  pendingReply: ((answer: string) => void) | undefined;
};

const runtimePath = resolve(".runtime/session.json");
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("Set TYPESAFE_API_KEY in .env before starting the session.");

const token = randomBytes(32).toString("hex");
const startedAt = Date.now();
const expiresAt = startedAt + 60 * 60 * 1000;
let chrome = new ChromeSession();
let connection: "connecting" | "ready" | "error" = "connecting";
let connectionError = "";
let connectionMs = 0;
let run: Run | undefined;
let closing = false;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 64_000) throw new Error("Request body too large.");
  }
  return JSON.parse(text || "{}") as unknown;
}

function event(current: Run, type: Event["type"], message: string): void {
  current.events.push({ index: current.events.length, type, message });
}

async function connect(): Promise<void> {
  if (connection === "ready") return;
  connection = "connecting";
  connectionError = "";
  chrome = new ChromeSession();
  const started = performance.now();
  try {
    await chrome.connect();
    connectionMs = Math.round(performance.now() - started);
    connection = "ready";
  } catch (error) {
    connection = "error";
    connectionError = error instanceof Error ? error.message : String(error);
  }
}

async function startRun(options: AgentOptions): Promise<Run> {
  const current: Run = { id: randomUUID(), events: [], status: "running", pendingReply: undefined };
  run = current;
  const decisions: Decision[] = [];
  const began = performance.now();
  const begunAt = new Date().toISOString();
  let humanWaitMs = 0;
  const taskHash = createHash("sha256").update(options.task).digest("hex");
  void (async () => {
    let outcome = "error";
    try {
      const result = await runAgent(chrome, new JevClient(key!), {
        ...options,
        showMarker: true,
        log: (message) => event(current, "log", message),
        onDecision: (decision) => decisions.push(decision),
        ask: (message) => new Promise<string>((resolveReply) => {
          event(current, "prompt", message);
          const waitingSince = performance.now();
          const timer = setTimeout(() => {
            current.pendingReply = undefined;
            humanWaitMs += performance.now() - waitingSince;
            resolveReply("stop");
          }, 10 * 60 * 1000);
          current.pendingReply = (answer) => {
            clearTimeout(timer);
            current.pendingReply = undefined;
            humanWaitMs += performance.now() - waitingSince;
            resolveReply(answer);
          };
        }),
      });
      outcome = /^(JEV judged the task complete\.|Verified YouTube playback:)/.test(result) ? "complete" : "incomplete";
      event(current, "result", result);
    } catch (error) {
      event(current, "error", error instanceof Error ? error.message : String(error));
    } finally {
      current.status = "done";
      try {
        await saveMetric({
          kind: "jev", id: current.id, taskHash, startedAt: begunAt,
          durationMs: Math.round(performance.now() - began), outcome,
          humanWaitMs: Math.round(humanWaitMs),
          ...decisionMetric(decisions),
        });
      } catch (error) {
        event(current, "error", `Could not save run metric: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  })();
  return current;
}

const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${(server.address() as { port: number }).port}` ||
        req.headers.origin || req.headers.authorization !== `Bearer ${token}`) {
      json(res, 403, { error: "Forbidden." });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { connection, connectionError, connectionMs, expiresAt: new Date(expiresAt).toISOString(), activeRun: run?.status === "running" ? run.id : null });
    } else if (req.method === "POST" && url.pathname === "/connect") {
      if (run?.status === "running" || connection === "connecting") json(res, 409, { error: "Session is busy." });
      else { await connect(); json(res, connection === "ready" ? 200 : 503, { connection, connectionError }); }
    } else if (req.method === "POST" && url.pathname === "/runs") {
      if (connection !== "ready") { json(res, 503, { error: connectionError || "Chrome is connecting." }); return; }
      if (run?.status === "running") { json(res, 409, { error: "A run is already active.", id: run.id }); return; }
      const input = await body(req) as Partial<AgentOptions>;
      if (typeof input.task !== "string" || !input.task.trim() ||
          (input.startUrl !== undefined && typeof input.startUrl !== "string") ||
          (input.values !== undefined && (typeof input.values !== "object" || input.values === null || Array.isArray(input.values))) ||
          (input.maxSteps !== undefined && (!Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > 100))) {
        json(res, 400, { error: "Invalid run options." }); return;
      }
      const current = await startRun({ task: input.task, ...(input.startUrl ? { startUrl: input.startUrl } : {}), values: input.values ?? {}, maxSteps: input.maxSteps ?? 30, ask: async () => "", log: () => {} });
      json(res, 202, { id: current.id });
    } else if (req.method === "GET" && url.pathname.startsWith("/runs/")) {
      const id = url.pathname.slice("/runs/".length);
      if (!run || run.id !== id) { json(res, 404, { error: "Run not found." }); return; }
      const after = Number(url.searchParams.get("after") ?? "-1");
      json(res, 200, { id, status: run.status, awaitingAnswer: Boolean(run.pendingReply), events: run.events.filter((item) => item.index > after) });
    } else if (req.method === "POST" && url.pathname.endsWith("/answer")) {
      const id = url.pathname.slice("/runs/".length, -"/answer".length);
      if (!run || run.id !== id || !run.pendingReply) { json(res, 409, { error: "No answer is pending." }); return; }
      const input = await body(req) as { answer?: unknown };
      if (typeof input.answer !== "string") { json(res, 400, { error: "Answer must be a string." }); return; }
      run.pendingReply(input.answer);
      json(res, 200, { accepted: true });
    } else if (req.method === "POST" && url.pathname === "/stop") {
      if (run?.status === "running") { json(res, 409, { error: "Wait for the active run to finish." }); return; }
      json(res, 200, { stopped: true });
      void shutdown();
    } else {
      json(res, 404, { error: "Not found." });
    }
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  server.close();
  await chrome.close().catch(() => {});
  try {
    const saved = JSON.parse(await readFile(runtimePath, "utf8")) as { token?: string };
    if (saved.token === token) await rm(runtimePath);
  } catch {}
}

await mkdir(resolve(".runtime"), { recursive: true });
server.listen(0, "127.0.0.1", async () => {
  const port = (server.address() as { port: number }).port;
  await writeFile(runtimePath, JSON.stringify({ port, token, pid: process.pid, expiresAt }), { mode: 0o600 });
  void connect();
});
setTimeout(() => {
  if (run?.status === "running") {
    const finish = setInterval(() => {
      if (run?.status !== "running") { clearInterval(finish); void shutdown(); }
    }, 1_000);
  } else void shutdown();
}, expiresAt - Date.now()).unref();
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
