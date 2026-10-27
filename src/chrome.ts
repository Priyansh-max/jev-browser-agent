import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

export interface PageInfo {
  id: number;
  url: string;
  selected: boolean;
}

export function parsePages(output: string): PageInfo[] {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+):\s+(.+?)(?:\s+\[selected\])?\s*$/.exec(line);
    if (!match) return [];
    return [{ id: Number(match[1]), url: match[2]!, selected: line.includes("[selected]") }];
  });
}

export class ChromeSession {
  private client = new Client({ name: "jev-browser-agent", version: "0.1.0" });
  private connected = false;

  async connect(): Promise<void> {
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const server = resolve(projectRoot, "node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js");
    const transport = new StdioClientTransport({ command: process.execPath, args: [server, "--autoConnect"] });
    await this.client.connect(transport);
    this.connected = true;
    try {
      await this.pages();
    } catch (error) {
      await this.close();
      throw new Error("Could not connect to your running Chrome. Open chrome://inspect/#remote-debugging in Chrome, enable remote debugging, then allow Chrome's connection prompt.", { cause: error });
    }
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });
    const output = result.content.flatMap((item) => item.type === "text" ? [item.text] : []).join("\n");
    if (result.isError) throw new Error(`${name}: ${output}`);
    return output;
  }

  async pages(): Promise<PageInfo[]> {
    return parsePages(await this.call("list_pages"));
  }

  async open(url: string): Promise<number> {
    await this.call("new_page", { url });
    const pages = await this.pages();
    const selected = pages.find((page) => page.selected);
    if (!selected) throw new Error("Chrome did not identify the new active tab.");
    return selected.id;
  }

  async snapshot(pageId: number): Promise<string> {
    return this.call("take_snapshot", { pageId, verbose: false });
  }

  async click(pageId: number, uid: string): Promise<void> {
    await this.call("click", { pageId, uid, includeSnapshot: false });
  }

  async fill(pageId: number, uid: string, value: string): Promise<void> {
    await this.call("fill", { pageId, uid, value, includeSnapshot: false });
  }

  async navigate(pageId: number, type: "back" | "reload"): Promise<void> {
    await this.call("navigate_page", { pageId, type });
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.client.close();
  }
}
