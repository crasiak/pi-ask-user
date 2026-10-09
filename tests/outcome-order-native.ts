// Offline source-composition regression: actual classic runner, native UI, and package loader; no provider calls.
import assert from "node:assert/strict";
import { Container, Text, isViewportTUI } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/tui/src/index.ts";
import { VirtualTerminal } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/tui/test/virtual-terminal.ts";
import { AuthStorage } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/core/auth-storage.ts";
import { createEventBus } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory, loadExtensions } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/core/extensions/loader.ts";
import { ExtensionRunner } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/core/extensions/runner.ts";
import type { ExtensionUIContext, UIPromptEndEvent, UIPromptStartEvent } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/core/extensions/types.ts";
import { KeybindingsManager } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/core/keybindings.ts";
import { SessionManager } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/core/session-manager.ts";
import { createInteractiveTui, InteractiveMode } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/modes/interactive/interactive-mode.ts";
import { initTheme } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/src/modes/interactive/theme/theme.ts";
import { createInMemoryModelRegistry } from "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui/packages/coding-agent/test/model-runtime-test-utils.ts";

const core = "/Users/jws/code/pi-worktrees/CRA-860-targeted-ui";
const packagePath = "/Users/jws/code/pi-ask-user-worktrees/CRA-860-afk-defer/index.ts";
type TuiMode = "regular" | "fullscreen";
type Path = "input" | "select" | "custom-overlay";
type Variant = "control" | "answer-first" | "cancel-first" | "end-listener" | "defer-first";
type PromptEvent = UIPromptStartEvent | UIPromptEndEvent;

function native(tuiMode: TuiMode) {
   const ui = createInteractiveTui({ tuiMode, showHardwareCursor: false, logDirectory: "/tmp", terminal: new VirtualTerminal() });
   ui.requestRender = () => {};
   const editor = Object.assign(new Text("draft", 0, 0), { getText: () => "draft", setText: () => {} });
   const editorContainer = new Container();
   editorContainer.addChild(editor);
   ui.addChild(editorContainer);
   if (isViewportTUI(ui)) ui.setLayoutRoot(editorContainer);
   ui.setFocus(editor);
   const mode = Object.assign(Object.create(InteractiveMode.prototype), {
      ui, renderer: ui, editor, editorContainer, keybindings: new KeybindingsManager(),
      extensionDialogClosers: new Map(), extensionTerminalInputSubscriptions: new Set(),
   }) as { createExtensionUIContext(): ExtensionUIContext };
   return { ui, editor, editorContainer, raw: mode.createExtensionUIContext() };
}

async function race(tuiMode: TuiMode, path: Path, variant: Variant) {
   const trace: unknown[] = [];
   const lifecycle: PromptEvent[] = [];
   const bus = createEventBus();
   const runtime = createExtensionRuntime();
   const loaded = await loadExtensions([packagePath], core, bus, runtime);
   assert.deepEqual(loaded.errors, []);
   let opened: Record<string, unknown> | undefined;
   let reply: Record<string, unknown> | undefined;
   bus.on("ask:defer:v1:opened", (value) => { opened = value as Record<string, unknown>; });
   bus.on("ask:defer:v1:reply", (value) => { reply = value as Record<string, unknown>; trace.push({ reply }); });
   const request = () => {
      assert(opened);
      trace.push("defer-request");
      bus.emit("ask:defer:v1:request", {
         ...opened, version: 1, requestId: `${tuiMode}-${path}-${variant}`, method: "defer", reason: "deferred_by_afk",
      });
   };
   const lifecycleObserver = await loadExtensionFromFactory((pi) => {
      pi.on("ui_prompt_start", (event) => { lifecycle.push(event); trace.push(event); });
      pi.on("ui_prompt_end", (event) => {
         lifecycle.push(event); trace.push(event);
         const targetKind = path === "custom-overlay" ? "custom" : path;
         if (variant === "end-listener" && event.kind === targetKind) request();
      });
   }, core, bus, runtime);
   const runner = new ExtensionRunner(
      [...loaded.extensions, lifecycleObserver], runtime, core, SessionManager.inMemory(),
      await createInMemoryModelRegistry(AuthStorage.inMemory()),
   );
   const h = native(tuiMode);
   let nativeResult: unknown = Symbol("pending");
   if (path === "input") {
      const input = h.raw.input;
      h.raw.input = (...args) => {
         const promise = input(...args);
         void promise.then((value) => { nativeResult = value; trace.push({ nativeResult: value ?? null }); });
         return promise;
      };
   } else if (path === "select") {
      h.raw.custom = async () => undefined as never;
      const select = h.raw.select;
      h.raw.select = (...args) => {
         const promise = select(...args);
         void promise.then((value) => { nativeResult = value; trace.push({ nativeResult: value ?? null }); });
         return promise;
      };
   } else {
      const custom = h.raw.custom.bind(h.raw);
      h.raw.custom = ((...args: Parameters<ExtensionUIContext["custom"]>) => {
         const promise = custom(...args);
         void promise.then((value) => { nativeResult = value; trace.push({ nativeResult: value ?? null }); });
         return promise;
      }) as ExtensionUIContext["custom"];
   }
   runner.setUIContext(h.raw, "tui");
   const tool = runner.getToolDefinition("ask_user");
   assert(tool);
   const resultPromise = tool.execute(
      `native-${path}`,
      path === "input"
         ? { question: "Offline question" }
         : { question: "Offline question", options: [{ title: "Alpha" }, { title: "Beta" }] },
      undefined,
      undefined,
      runner.createContext(),
   );
   let earlyResult: unknown;
   void resultPromise.then((value) => { earlyResult = value; });
   for (let i = 0; i < 10 && !opened; i++) await new Promise<void>((resolve) => setImmediate(resolve));
   assert(opened, `interaction did not open: ${JSON.stringify(earlyResult)}`);
   await new Promise<void>((resolve) => setImmediate(resolve));

   if (variant === "defer-first") {
      request();
   } else {
      const component = path === "custom-overlay" ? h.ui.getFocusedComponent() : h.editorContainer.children[0];
      assert(component);
      assert.notEqual(component, h.editor);
      if (path === "input" && variant !== "cancel-first") component.handleInput?.("human");
      component.handleInput?.(variant === "cancel-first" ? "\x1b" : "\r");
      assert.equal(h.ui.getFocusedComponent(), h.editor);
      trace.push("native-ui-closed");
      if (variant === "answer-first" || variant === "cancel-first") request();
   }

   const result = await resultPromise;
   await Promise.resolve();
   const details = result.details as { cancelled: boolean; reason?: string; response: unknown; interactionId: string };
   if (variant === "defer-first") {
      assert.equal(reply?.status, "accepted");
      assert.equal(details.reason, "deferred_by_afk");
      assert.equal(details.response, null);
   } else if (variant === "cancel-first") {
      assert.equal(reply?.status, "already_settled");
      assert.equal(details.cancelled, true);
      assert.equal(details.reason, undefined);
      assert.equal(details.response, null);
   } else {
      assert.equal(details.cancelled, false);
      assert.equal(details.reason, undefined);
      if (variant === "control") assert.equal(reply, undefined);
      else assert.equal(reply?.status, "already_settled");
   }
   if (path === "input") assert.equal(nativeResult, variant === "cancel-first" || variant === "defer-first" ? undefined : "human");
   if (path === "select") assert.equal(nativeResult, variant === "cancel-first" || variant === "defer-first" ? undefined : "Alpha");
   if (path === "custom-overlay") {
      if (variant === "cancel-first" || variant === "defer-first") assert.equal(nativeResult, null);
      else assert.deepEqual(nativeResult, { kind: "selection", selections: ["Alpha"] });
   }
   const targetKind = path === "custom-overlay" ? "custom" : path;
   const ownedTargetEvents = lifecycle.filter((event) => event.kind === targetKind);
   assert.equal(ownedTargetEvents.length, 2);
   assert.deepEqual(ownedTargetEvents.map((event) => event.type), ["ui_prompt_start", "ui_prompt_end"]);
   assert.deepEqual(ownedTargetEvents.map((event) => event.owner), [
      { namespace: "pi-ask-user", id: details.interactionId },
      { namespace: "pi-ask-user", id: details.interactionId },
   ]);
   trace.push({ result });
   console.log(JSON.stringify({ tuiMode, path, variant, nativeResult: nativeResult ?? null, reply, details, lifecycle, trace }));
   await runner.emit({ type: "session_shutdown", reason: "reload" });
   bus.clear();
}

async function main() {
   initTheme("dark");
   for (const tuiMode of ["regular", "fullscreen"] as const) {
      for (const path of ["input", "select", "custom-overlay"] as const) {
         for (const variant of ["control", "answer-first", "cancel-first", "end-listener", "defer-first"] as const) {
            await race(tuiMode, path, variant);
         }
      }
   }
   console.log(JSON.stringify({ passed: true, cases: 30 }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
