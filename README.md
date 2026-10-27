# JEV Browser Agent

An experimental JEV-only agent that operates in the Chrome session already open on your computer. It uses Chrome DevTools MCP to read accessibility snapshots and act on snapshot element IDs. No browser extension or separate Chrome profile is required.

## Run

Requires Node.js 22.16+, Chrome 144+, and a TypeSafe API key.

1. In your running Chrome, open `chrome://inspect/#remote-debugging` and enable remote debugging. Approve Chrome's connection prompt for a new connection.
2. Add your key to the ignored `.env` file in this project: `TYPESAFE_API_KEY=your-key`.
3. Run:

```powershell
npm install
npm start -- 'Open https://example.com and inspect the page'
```

The agent opens an explicit URL in a new tab of **your existing Chrome session**. For public information tasks beginning with “find,” “search,” or similar wording, it can open a rule-based Google query. For work on an already open site, it uses the selected tab. You can specify a site explicitly:

```powershell
npm start -- --start https://example.com 'Find the invoice for order 123'
```

Give exact form values with repeated `--value Label=exact text` arguments, or enter them when prompted. The agent never asks JEV to generate arbitrary text.

## Test from Codex chat

Ask Codex to run a browser task through this project. It can invoke the commands below and report the events in this chat. A violet border inside the page viewport shows the tab currently controlled by JEV; the border is removed when the run ends.

```powershell
npm run chat -- start
npm run chat -- run 'Open https://example.com and click Learn more'
npm run chat -- status
npm run chat -- stop
```

The local session holds one Chrome DevTools connection for up to one hour and allows one run at a time. Chrome owns the remote debugging approval: the project cannot grant or extend it. A new connection after expiry or a disconnect may trigger Chrome's own prompt. Only the session owner can call the loopback service with the random token stored in ignored `.runtime/session.json`. It accepts no browser-origin requests. If an action needs approval or exact text, the run pauses and prints a run ID; send a reply with `npm run chat -- answer <run-id> yes`, then `npm run chat -- watch <run-id>`. Omit the final answer argument to read it from standard input.

## Compare runs

Each JEV run records wall time, outcome, model calls, JEV input and output tokens, decision time, human wait time, and estimated API cost in ignored `traces/runs.jsonl`. Task text and page contents are not saved there. The estimate uses TypeSafe's published $0.042 per million input tokens and $0 output tokens; set `JEV_INPUT_USD_PER_MILLION` in `.env` if that rate changes.

Run the identical task with Codex computer use, time it, then record its measured wall time:

```powershell
npm run benchmark -- baseline --task 'Open https://example.com and click Learn more' --duration-ms 9000 --outcome complete
npm run benchmark -- report
```

Add `--cost-usd <measured amount>` only when Codex exposes a measured cost. Without its usage data, the report leaves Codex cost unknown instead of inventing a comparison. Compare only matching task hashes and successful outcomes; session startup and human wait time can distort short runs.

## Loop and boundaries

Each step takes a fresh accessibility snapshot, presents up to 180 page actions to JEV, checks the selected element against another fresh snapshot, acts, then observes again. A maximum step count stops repeated loops. If the initial Chrome connection fails, the CLI explains the debugging toggle and retries after you enable it. Login and CAPTCHA pages pause for manual completion in Chrome. Consequential clicks and sensitive form fields require confirmation. Browser dialogs are handled explicitly. YouTube play tasks skip ads when YouTube offers a Skip control, wait up to 90 seconds for unskippable ads, and verify actual video playback from player controls. A failed page gets one reload; repeated action failures stop the run.

JEV's goal check is a judgment over the browser observation. The final page is shown for user verification. The approval policy currently uses page labels and cannot reliably identify every consequential action. This is an experimental vertical slice, not yet a reliable agent for every website or every task. Tasks that require newly composed prose, complex visual understanding, or unavailable page controls remain unsupported.

Browser page text is sent to TypeSafe as JEV input. The API key, Chrome cookies, snapshots, and local logs are not committed to this repository. Chrome's permission prompt controls access to the existing session.

## Check

```powershell
npm run typecheck
npm test
```
