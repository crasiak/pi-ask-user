/** Offline classic-source terminal fixture. Load only explicitly with -e; never shipped. */
import { existsSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import type { ExtensionAPI, ToolDefinition, UIPromptEndEvent, UIPromptStartEvent } from "@earendil-works/pi-coding-agent";
import askUser from "../index.ts";
import { DEFER_OPENED, DEFER_REPLY, DEFER_REQUEST } from "../cooperative-defer.ts";

export default function fixture(pi: ExtensionAPI) {
   let tool: ToolDefinition;
   const proxy = new Proxy(pi, {
      get(target, property) {
         if (property === "registerTool") return (value: ToolDefinition) => { tool = value; pi.registerTool(value); };
         return Reflect.get(target, property);
      },
   });
   askUser(proxy);
   let watcher: FSWatcher | undefined;
   pi.on("session_shutdown", () => { watcher?.close(); });
   pi.registerCommand("afk-fixture", {
      description: "Offline ownership/AFK regression (no agent/provider call)",
      async handler(kind, ctx) {
         const directory = process.env.AFK_FIXTURE_DIR!;
         if (!directory) throw new Error("AFK_FIXTURE_DIR required");
         const controller = new AbortController();
         let ids: Record<string, unknown> | undefined;
         let reply: unknown;
         let closed = false;
         const lifecycle: (UIPromptStartEvent | UIPromptEndEvent)[] = [];
         const offStart = pi.on("ui_prompt_start", (event) => { lifecycle.push(event); });
         const offEnd = pi.on("ui_prompt_end", (event) => { lifecycle.push(event); });
         const offOpened = pi.events.on(DEFER_OPENED, (value) => {
            ids = value as Record<string, unknown>;
            writeFileSync(`${directory}/opened.json`, JSON.stringify(ids));
         });
         const offReply = pi.events.on(DEFER_REPLY, (value) => {
            reply = value;
            // Refusal leaves the UI alone. The test explicitly aborts it only after recording refusal.
            if ((value as { status: string }).status === "unsupported_ui") controller.abort();
         });
         watcher = watch(directory, () => {
            if (closed || !ids || !existsSync(`${directory}/defer`)) return;
            closed = true;
            watcher?.close();
            pi.events.emit(DEFER_REQUEST, { ...ids, version: 1, requestId: "terminal-fixture", method: "defer", reason: "deferred_by_afk" });
         });
         try {
            const result = await tool!.execute(`fixture-${kind}`, {
               question: `CRA860 ${kind} question`,
               ...(kind === "freeform" ? {} : { options: [{ title: "Alpha" }, { title: "Beta" }] }),
               displayMode: kind === "inline" ? "inline" : "overlay",
            }, controller.signal, undefined, ctx);
            // accepted replies are queued after executor cleanup.
            await Promise.resolve();
            writeFileSync(`${directory}/result.json`, JSON.stringify({ result, reply, mode: ctx.mode, capability: ctx.ui.targetedDialogCancellation, attribution: ctx.ui.uiPromptOwnership, lifecycle }));
            ctx.ui.notify(`CRA860 ${kind} finished`);
         } finally {
            watcher?.close(); offOpened(); offReply(); offStart(); offEnd();
         }
      },
   });
}
