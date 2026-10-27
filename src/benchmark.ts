import { createHash, randomUUID } from "node:crypto";
import { readMetrics, saveMetric } from "./metrics.js";

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

const [command, ...args] = process.argv.slice(2);
if (command === "baseline") {
  const task = value(args, "--task");
  const durationMs = Number(value(args, "--duration-ms"));
  const outcome = value(args, "--outcome");
  const suppliedCost = value(args, "--cost-usd");
  if (!task || !Number.isFinite(durationMs) || durationMs <= 0 || !outcome ||
      (suppliedCost !== undefined && (!Number.isFinite(Number(suppliedCost)) || Number(suppliedCost) < 0))) {
    throw new Error("Use: benchmark baseline --task <text> --duration-ms <number> --outcome <text> [--cost-usd <number>]");
  }
  await saveMetric({
    kind: "codex-computer-use", id: randomUUID(),
    taskHash: createHash("sha256").update(task).digest("hex"),
    startedAt: new Date().toISOString(), durationMs, outcome,
    costUsd: suppliedCost === undefined ? null : Number(suppliedCost),
    costBasis: suppliedCost === undefined ? "Codex tool usage and cost not exposed here." : "Provided measurement.",
  });
  console.log("Computer-use baseline recorded.");
} else if (command === "report") {
  const metrics = await readMetrics();
  if (metrics.length === 0) {
    console.log("No runs recorded.");
  } else {
    const hashes = [...new Set(metrics.map((item) => item.taskHash))];
    for (const hash of hashes) {
      const jev = metrics.filter((item) => item.taskHash === hash && item.kind === "jev").at(-1);
      const codex = metrics.filter((item) => item.taskHash === hash && item.kind === "codex-computer-use").at(-1);
      console.log(JSON.stringify({
        task: hash.slice(0, 12),
        jev: jev && { id: jev.id, durationMs: jev.durationMs, humanWaitMs: jev.humanWaitMs, decisionLatencyMs: jev.decisionLatencyMs, outcome: jev.outcome, decisions: jev.decisions, inputTokens: jev.inputTokens, outputTokens: jev.outputTokens, costUsd: jev.costUsd },
        codex: codex && { durationMs: codex.durationMs, outcome: codex.outcome, costUsd: codex.costUsd },
        speedRatio: jev && codex && jev.outcome === "complete" && codex.outcome === "complete" ? Number((codex.durationMs / jev.durationMs).toFixed(2)) : null,
      }));
    }
  }
} else {
  throw new Error("Use: benchmark baseline ... | report");
}
