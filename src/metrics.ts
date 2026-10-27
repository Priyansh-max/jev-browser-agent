import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Decision } from "./jev.js";

export interface RunMetric {
  kind: "jev" | "codex-computer-use";
  id: string;
  taskHash: string;
  startedAt: string;
  durationMs: number;
  outcome: string;
  decisions?: number;
  inputTokens?: number;
  outputTokens?: number;
  decisionLatencyMs?: number;
  humanWaitMs?: number;
  costUsd: number | null;
  costBasis: string;
}

const metricsPath = resolve("traces/runs.jsonl");

export async function saveMetric(metric: RunMetric): Promise<void> {
  await mkdir(dirname(metricsPath), { recursive: true });
  await appendFile(metricsPath, JSON.stringify(metric) + "\n", "utf8");
}

export async function readMetrics(): Promise<RunMetric[]> {
  try {
    return (await readFile(metricsPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunMetric);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function decisionMetric(decisions: Decision[]): Pick<RunMetric, "decisions" | "inputTokens" | "outputTokens" | "decisionLatencyMs" | "costUsd" | "costBasis"> {
  const inputTokens = decisions.reduce((sum, decision) => sum + decision.inputTokens, 0);
  const outputTokens = decisions.reduce((sum, decision) => sum + decision.outputTokens, 0);
  const rate = Number(process.env.JEV_INPUT_USD_PER_MILLION ?? "0.042");
  if (!Number.isFinite(rate) || rate < 0) throw new Error("JEV_INPUT_USD_PER_MILLION must be a nonnegative number.");
  return {
    decisions: decisions.length,
    inputTokens,
    outputTokens,
    decisionLatencyMs: decisions.reduce((sum, decision) => sum + decision.latencyMs, 0),
    costUsd: inputTokens * rate / 1_000_000,
    costBasis: `Estimated at $${rate}/million input tokens; TypeSafe lists Jev output at $0. Set JEV_INPUT_USD_PER_MILLION to update the rate.`,
  };
}
