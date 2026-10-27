# JEV Browser Agent

An experimental JEV-only agent that operates in the Chrome session already open on your computer. It uses Chrome DevTools MCP to read accessibility snapshots and act on snapshot element IDs. No browser extension or separate Chrome profile is required.

## Run

Requires Node.js 20+, Chrome 144+, and a TypeSafe API key.

1. In your running Chrome, open `chrome://inspect/#remote-debugging` and enable remote debugging. Approve Chrome's connection prompt when the agent starts.
2. Set `TYPESAFE_API_KEY` in your local environment.
3. Run:

```powershell
npm install
$env:TYPESAFE_API_KEY = '<your key>'
npm start -- 'Open https://example.com and inspect the page'
```

The agent opens an explicit URL in a new tab of **your existing Chrome session**. For public information tasks beginning with “find,” “search,” or similar wording, it can open a rule-based Google query. For work on an already open site, it uses the selected tab. You can specify a site explicitly:

```powershell
npm start -- --start https://example.com 'Find the invoice for order 123'
```

Give exact form values with repeated `--value Label=exact text` arguments, or enter them when prompted. The agent never asks JEV to generate arbitrary text.

## Loop and boundaries

Each step takes a fresh accessibility snapshot, presents up to 180 page actions to JEV, checks the selected element against another fresh snapshot, acts, then observes again. A maximum step count stops repeated loops. Login and CAPTCHA pages pause for manual completion in Chrome. Consequential clicks require confirmation. Browser dialogs are handled explicitly. A failed page gets one reload; repeated action failures stop the run.

JEV's goal check is a judgment over the browser observation. The final page is shown for user verification. This is an experimental vertical slice, not yet a reliable agent for every website or every task. Tasks that require newly composed prose, complex visual understanding, or unavailable page controls remain unsupported.

Browser page text is sent to TypeSafe as JEV input. The API key, Chrome cookies, snapshots, and local logs are not committed to this repository. Chrome's permission prompt controls access to the existing session.

## Check

```powershell
npm run typecheck
npm test
```
