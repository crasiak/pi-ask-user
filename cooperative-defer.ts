import { randomUUID } from "node:crypto";

export const DEFER_REQUEST = "ask:defer:v1:request";
export const DEFER_REPLY = "ask:defer:v1:reply";
export const DEFER_OPENED = "ask:defer:v1:opened";
export const DEFER_CLOSED = "ask:defer:v1:closed";
export const DEFER_TEXT = "No completed human answer was submitted; the question was deferred because AFK is active.";
export type DialogKind = "input" | "select" | "custom-overlay" | "custom-inline";
type Outcome = "pending" | "answered" | "cancelled" | "deferred" | "error";
interface Bus {
   on(channel: string, handler: (data: unknown) => void): () => void;
   emit(channel: string, data: unknown): void;
}

/** One complete outcome owns both attribution and dismissal. Drafts never enter this arbiter. */
export class QuestionInteraction<T> {
   readonly interactionId = randomUUID();
   readonly owner = Object.freeze({ namespace: "pi-ask-user", id: this.interactionId });
   readonly toolCallId: string;
   outcome: Outcome = "pending";
   response: T | null = null;
   kind: DialogKind | undefined;
   supported = false;
   uiPromptAttribution = false;
   private dismiss?: () => void;
   private announced = false;
   private finished = false;
   private resolveClosed!: () => void;
   readonly closed = new Promise<void>((resolve) => { this.resolveClosed = resolve; });
   private readonly bus: Bus;

   constructor(toolCallId: string, bus: Bus) {
      this.toolCallId = toolCallId;
      this.bus = bus;
   }
   get ids() { return { toolCallId: this.toolCallId, interactionId: this.interactionId }; }
   metadata() {
      return { ...this.ids, kind: this.kind, supported: this.supported, uiPromptAttribution: this.uiPromptAttribution, owner: this.owner, state: this.outcome };
   }
   wire(kind: DialogKind, supported: boolean, dismiss: () => void, uiPromptAttribution: boolean) {
      this.kind = kind;
      this.supported = supported;
      this.uiPromptAttribution = uiPromptAttribution;
      this.dismiss = dismiss;
      if (this.outcome !== "pending") { dismiss(); return; }
      if (!this.announced) {
         this.announced = true;
         this.bus.emit(DEFER_OPENED, { version: 1, ...this.metadata() });
      }
   }
   complete(response: T | null): T | null {
      if (this.outcome === "pending") {
         this.outcome = response === null ? "cancelled" : "answered";
         this.response = response;
      }
      return this.response;
   }
   cancel(outcome: "cancelled" | "deferred" = "cancelled"): boolean {
      if (this.outcome !== "pending") return false;
      this.outcome = outcome; // Commit before invoking the UI owner's callback/signal.
      this.dismiss?.();
      return true;
   }
   fail() { this.outcome = "error"; }
   finish() {
      if (this.finished) return;
      this.finished = true;
      if (this.outcome === "pending") this.outcome = "cancelled";
      this.dismiss = undefined;
      this.resolveClosed();
      if (this.announced) this.bus.emit(DEFER_CLOSED, { version: 1, ...this.metadata() });
   }
}

function boundedId(value: unknown): value is string {
   return typeof value === "string" && value.length > 0 && value.length <= 256;
}
function remember(set: Set<string>, value: string) {
   set.add(value);
   if (set.size > 256) set.delete(set.values().next().value!);
}

/** Trusted in-process messages only: this does not register model-callable authority. */
export class CooperativeDefer {
   private readonly bus: Bus;
   private readonly pending = new Map<string, QuestionInteraction<unknown>>();
   private readonly settled = new Set<string>();
   private readonly requests = new Set<string>();
   private unsubscribe?: () => void;
   constructor(bus: Bus) { this.bus = bus; }
   start() {
      if (!this.unsubscribe) this.unsubscribe = this.bus.on(DEFER_REQUEST, (data) => this.request(data));
   }
   create<T>(toolCallId: string): QuestionInteraction<T> {
      const call = new QuestionInteraction<T>(toolCallId, this.bus);
      this.pending.set(call.interactionId, call);
      return call;
   }
   finish(call: QuestionInteraction<unknown>) {
      this.pending.delete(call.interactionId);
      remember(this.settled, `${call.toolCallId}\0${call.interactionId}`);
      call.finish();
   }
   async shutdown() {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      const active = [...this.pending.values()];
      for (const call of active) call.cancel();
      await Promise.all(active.map((call) => call.closed));
      this.requests.clear();
      this.settled.clear();
   }
   private request(data: unknown) {
      if (!data || typeof data !== "object") return;
      const r = data as Record<string, unknown>;
      if (!boundedId(r.requestId)) return; // No unbounded/unusable correlation data is echoed.
      const correlation = { version: 1, requestId: r.requestId, method: r.method };
      const reply = (status: string, extra = {}) => this.bus.emit(DEFER_REPLY, { ...correlation, status, ...extra });
      if (r.version !== 1 || (r.method !== "capabilities" && r.method !== "defer")) {
         reply("invalid_request"); return;
      }
      if (r.method === "capabilities") {
         const calls = [...this.pending.values()].filter((call) => call.kind !== undefined);
         reply("capabilities", { pending: calls.slice(0, 32).map((call) => call.metadata()), truncated: calls.length > 32 });
         return;
      }
      if (!boundedId(r.toolCallId) || !boundedId(r.interactionId) || r.reason !== "deferred_by_afk") {
         reply("invalid_request"); return;
      }
      const ids = { toolCallId: r.toolCallId, interactionId: r.interactionId };
      if (this.requests.has(r.requestId)) { reply("already_requested", ids); return; }
      remember(this.requests, r.requestId);
      const call = this.pending.get(r.interactionId);
      if (!call || call.toolCallId !== r.toolCallId) {
         reply(this.settled.has(`${r.toolCallId}\0${r.interactionId}`) ? "already_settled" : "not_pending", ids);
         return;
      }
      // Already-queued complete answer continuations must run before deferral commits.
      queueMicrotask(() => {
         if (call.outcome !== "pending") { reply("already_settled", ids); return; }
         if (!call.supported || !call.kind) { reply("unsupported_ui", { ...ids, kind: call.kind }); return; }
         call.cancel("deferred");
         // The executor finishes only after the UI promise and all owned cleanup settle.
         void call.closed.then(() => reply(call.outcome === "deferred" ? "accepted" : "cleanup_failed", { ...ids, reason: "deferred_by_afk" }));
      });
   }
}
