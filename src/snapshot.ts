export interface ActionCandidate {
  key: string;
  uid: string;
  role: string;
  description: string;
}

const ACTION_ROLE = /^(button|link|textbox|searchbox|combobox|checkbox|radio|switch|tab|menuitem|option)$/i;

export function actionsFromSnapshot(snapshot: string): ActionCandidate[] {
  const actions: ActionCandidate[] = [];
  for (const line of snapshot.split("\n")) {
    const match = /uid=([\w-]+)\s+(\w+)\b(.*)/.exec(line);
    if (!match || !ACTION_ROLE.test(match[2]!)) continue;
    const role = match[2]!.toLowerCase();
    const description = match[3]!.trim();
    if (/\bpassword\b/i.test(description)) continue;
    actions.push({ key: `action_${actions.length}`, uid: match[1]!, role, description: `${role} ${description}`.slice(0, 240) });
  }
  return actions;
}

export function needsHuman(snapshot: string): string | undefined {
  if (/recaptcha|hcaptcha|verify you are human|captcha challenge/i.test(snapshot)) return "CAPTCHA or human verification";
  if (/uid=[\w-]+\s+(?:textbox|input)\s+["']?password/i.test(snapshot)) return "login or password entry";
  return undefined;
}

export function taskUrl(task: string): string | undefined {
  const match = /https?:\/\/[^\s<>"']+/i.exec(task);
  if (!match) return undefined;
  try {
    const url = new URL(match[0].replace(/[.,;!?)]*$/, ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function searchUrl(task: string): string | undefined {
  if (!/^(find|search|look up|research|compare|what|which|where|who|when|how)\b/i.test(task.trim())) return undefined;
  if (/\b(my|mine|private|account|inbox|password|bank|order)\b/i.test(task)) return undefined;
  const query = task.trim().replace(/^(?:find|search(?: for)?|look up|research|compare)\s+/i, "").replace(/[?.!]+$/, "");
  return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : undefined;
}
