# pi-ask-user

A Pi package that adds an interactive `ask_user` tool for collecting user decisions during an agent run.

## Demo

![ask_user demo](./media/ask-user-demo.gif)

High-quality video: [ask-user-demo.mp4](./media/ask-user-demo.mp4)

## Features

- Searchable single-select option lists with wrapped titles and descriptions
- Responsive split-pane details preview on wide terminals with single-column fallback on narrow terminals
- Multi-select option lists
- Optional freeform responses
- User-toggleable extra context on structured selections
- Context display support
- Configurable display mode: `overlay` (modal, default) or `inline` (rendered directly in the flow)
- Runtime overlay toggle: press the configured overlay-toggle key (`alt+o` by default, configurable per call or via env var) while the prompt is open to temporarily hide/show the popup so you can read prior agent output, then press it again to bring it back
- Pi-TUI-aligned keybinding and editor behavior
- Custom TUI rendering for tool calls and results
- System prompt integration via `promptSnippet` and `promptGuidelines`
- Optional timeout for auto-dismiss in both overlay and fallback input modes
- Structured `details` on all results for session state reconstruction
- Graceful fallback when interactive UI is unavailable
- Bundled `ask-user` skill for mandatory decision-gating in high-stakes or ambiguous tasks

## Bundled skill: `ask-user`

This package now ships a skill at `skills/ask-user/SKILL.md` that nudges/mandates the agent to use `ask_user` when:

- architectural trade-offs are high impact
- requirements are ambiguous or conflicting
- assumptions would materially change implementation

The skill follows a "decision handshake" flow:

1. Gather evidence and summarize context
2. Ask one focused question via `ask_user`
3. Wait for explicit user choice
4. Confirm the decision, then proceed

See: `skills/ask-user/references/ask-user-skill-extension-spec.md`.

## Install

```bash
pi install npm:pi-ask-user
```

## Tool name

The registered tool name is:

- `ask_user`

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `question` | `string` | *required* | The question to ask the user |
| `context` | `string?` | — | Relevant context summary shown before the question |
| `options` | `{title, description?}[]?` | `[]` | Multiple-choice options. The schema is a flat object shape (no `anyOf`, which some provider proxies strip or reject); plain strings and common alias keys (`label`, `text`, `value`, `name`, `option`) are still accepted at runtime |
| `allowMultiple` | `boolean?` | `false` | Enable multi-select mode |
| `allowFreeform` | `boolean?` | `true` | Add a "Type something" freeform option |
| `allowComment` | `boolean?` | `false` | Expose a user-toggleable extra-context option in the custom UI (`ctrl+g` or the toggle row) and collect an optional comment in fallback dialogs |
| `displayMode` | `"overlay" \| "inline"?` | env var or `"overlay"` | Controls custom UI rendering: `overlay` shows the centered modal (current behavior), `inline` renders without overlay framing |
| `overlayToggleKey` | `string?` | env var or `"alt+o"` | Shortcut for hiding/showing the overlay popup (overlay mode only). Pi-TUI key spec, e.g. `"alt+o"`, `"ctrl+shift+h"`. Pass `"off"` to disable. |
| `commentToggleKey` | `string?` | env var or `"ctrl+g"` | Shortcut for toggling the optional comment/extra-context row when `allowComment: true`. Pass `"off"` to disable. |
| `timeout` | `number?` | — | Auto-dismiss after N ms and return `null` if the prompt times out |

## Example usage shape

```json
{
  "question": "Which option should we use?",
  "context": "We are choosing a deploy target.",
  "options": [
    { "title": "staging" },
    { "title": "production", "description": "Customer-facing" }
  ],
  "allowMultiple": false,
  "allowFreeform": true,
  "allowComment": true,
  "displayMode": "inline"
}
```

`displayMode: "inline"` uses the same interaction logic but skips overlay mode when calling `ctx.ui.custom(...)`. RPC/headless fallback behavior is unchanged.

## Personal preferences via environment variables

Configure your defaults globally by setting these in your shell profile (`~/.zshrc`, `~/.bash_profile`, etc.):

```bash
export PI_ASK_USER_DISPLAY_MODE=inline
export PI_ASK_USER_OVERLAY_TOGGLE_KEY=alt+h
export PI_ASK_USER_COMMENT_TOGGLE_KEY=alt+c
```

### Display mode

Effective order:

1. Per-call `displayMode` parameter (if provided)
2. `PI_ASK_USER_DISPLAY_MODE` (if set to `"overlay"` or `"inline"`)
3. Fallback default: `"overlay"`

Unrecognised values are silently ignored and fall back to `"overlay"`.

### Shortcuts

Effective order for both `overlayToggleKey` and `commentToggleKey`:

1. Per-call parameter (if provided)
2. Matching env var (`PI_ASK_USER_OVERLAY_TOGGLE_KEY` / `PI_ASK_USER_COMMENT_TOGGLE_KEY`)
3. Built-in defaults: `alt+o` and `ctrl+g`

Pass `"off"`, `"none"`, or `"disabled"` (at any level) to disable the shortcut entirely. Invalid specs are silently dropped and the next source is used. Specs follow the Pi-TUI [`KeyId`](https://github.com/earendil-works/pi-mono/blob/main/packages/tui/src/keys.ts) format: `[mod+]...key` where modifiers are `ctrl`, `shift`, `alt`, `super`, in any order, joined by `+` (e.g. `ctrl+g`, `alt+shift+x`, `escape`, `tab`).

## Controls

While an `ask_user` prompt is open:

| Key | Action |
|-----|--------|
| `alt+o` (configurable via `overlayToggleKey`) | Hide/show the overlay popup so you can read the agent's prior output. Available in `overlay` mode only. The first time you hide it, a notification reminds you which key brings it back. |
| `ctrl+g` (configurable via `commentToggleKey`) | Toggle the optional comment/extra-context row (when `allowComment: true`). |
| `enter` | Confirm the focused option, submit a freeform response, or submit/skip an optional comment. |
| `esc` | Clear the search filter, exit freeform/comment mode, or cancel the prompt. |
| `↑` / `↓`, `ctrl+k` / `ctrl+j` | Navigate options. `ctrl+k` / `ctrl+j` (vim-style) work while typing in searchable prompts without disturbing the filter. |

If you prefer never to see the overlay, set `displayMode: "inline"` per call or `PI_ASK_USER_DISPLAY_MODE=inline` globally.

## Result details

All tool results include a structured `details` object for rendering and session state reconstruction:

```typescript
type AskResponse =
  | { kind: "selection"; selections: string[]; comment?: string }
  | { kind: "freeform"; text: string };

interface AskToolDetails {
  question: string;
  context?: string;
  options: QuestionOption[];
  response: AskResponse | null;
  cancelled: boolean;
}
```

## Cooperative deferral (unpublished local patch)

Ordinary asking, answering, and human cancellation remain available on existing hosts.
AFK deferral requires **native `ctx.mode === "tui"` and the matching
`ctx.ui.targetedDialogCancellation` capability**. Stock Pi 0.87.1 does not
provide that guarantee. The companion classic-core patch qualifies `input`,
`select`, and `custom-overlay`; it does **not** qualify `custom-inline`.
RPC, print/headless, missing markers, and unqualified layouts refuse deferral
without dismissing the question. There is no weaker cancellation fallback.
The package version and dependency pins are unchanged; this is not a release.

### Trusted in-process API, version 1

This API is an extension event-bus protocol, not a model-callable tool. Subscribe
to `ask:defer:v1:reply` before emitting on `ask:defer:v1:request`:

```typescript
pi.events.emit("ask:defer:v1:request", {
  version: 1, requestId: "discover-1", method: "capabilities",
});
// The capabilities reply contains pending [{toolCallId, interactionId, kind,
// supported, uiPromptAttribution, owner, state}], at most 32 entries,
// and a truncated boolean. No question text.
// After independently checking ownership/authority, target those exact IDs:
pi.events.emit("ask:defer:v1:request", {
  version: 1, requestId: "defer-1", method: "defer",
  toolCallId, interactionId, reason: "deferred_by_afk",
});
```

`requestId`, `toolCallId`, and `interactionId` must be nonempty strings of at most
256 characters. Each execution gets a fresh interaction UUID, even if a tool-call
ID is reused. Reply statuses are `capabilities`, `accepted`, `unsupported_ui`,
`not_pending`, `already_settled`, `already_requested`, `invalid_request`, or
`cleanup_failed`. Unusable request IDs are ignored. Replies echo version,
request ID, method, and (for validated defer requests) interaction IDs. Recent
request IDs and settled IDs are bounded to 256 entries; after eviction a stale
interaction remains harmless and is reported as `not_pending`.

`ask:defer:v1:opened` and `ask:defer:v1:closed` carry version, IDs, kind, supported,
uiPromptAttribution, owner, and state. Opened is emitted only after cancellation is wired. Pending discovery
reports the **current** kind, including fallback/comment dialog transitions;
opened is a once-per-interaction observation, not a promise that the kind cannot
change. Subscribe to observations and query capabilities for late discovery.

### UI completion attribution (D009 prerequisite)

Every UI call for an interaction (custom overlay/inline, freeform, fallback
selection, multi-selection, and optional comment) receives the frozen internal
`owner: { namespace: "pi-ask-user", id: interactionId }`. The registry creates a
fresh UUID per execution/reload and binds it to the actual `toolCallId`. Tool
parameters cannot select this token. Ownership is correlation, not authorization.

Pending/capabilities and opened/closed metadata report `uiPromptAttribution: true`
only for native TUI with the runner-provided
`ctx.ui.uiPromptOwnership === "exclusive-v1"` marker. A version string or
`targetedDialogCancellation` alone is insufficient. `supported` still means
component-only targeted deferral, independently of attribution. Thus an older
cancellation-qualified core can accept deferral with `uiPromptAttribution: false`;
a controller must refuse automatic continuation on that basis. Conversely,
inline may report attribution while `supported: false`; its cancellation remains
unqualified. RPC/headless remain unsupported, and missing/unknown attribution
markers are never advertised as support.

The core accepts nonempty namespace/ID strings of at most 256 UTF-16 code units,
copies them, and ignores malformed metadata without preventing UI. Its existing
outer-depth `ui_prompt_start/end` events are not suppressed. Start records only
the initial owner. End retains it only if every nested/overlapping prompt had the
same valid owner. Any unowned, invalid, or different owner clears end attribution
for the entire interval, regardless of completion order. A later same-owner prompt
cannot restore it before depth reaches zero. `uiPromptAttribution` advertises that
contract, not a promise that a particular end will be owned.

Unattributed/mixed ends must conservatively pause downstream even during an
outstanding defer request or after a late acceptance. An owned end alone does
not authorize continuation: future AoE integration still requires a live grant,
host-admitted exact IDs, an exclusively matching end, and a bounded exact
accepted cleanup reply. Human input, cancellation, timeouts, contradictory or
lost replies must retain precedence. This patch does not implement AoE
continuation, request reservations, or new permission.

### Outcome ordering

The first committed complete outcome wins. Deferral commitment is queued behind
already-enqueued UI answer-promise continuations; partial choices/comment drafts
are not complete answers. An `accepted` reply follows settlement of the owned UI
promise and cleanup, not just receipt of the request. Custom UI closes through
its owner's completion callback (including hidden overlays); built-in dialogs
use a dedicated per-execution signal. No answer is selected or typed, no terminal
keys are simulated, and the agent turn is not aborted.

A deferred result has `status: "no_human_answer"`, `reason: "deferred_by_afk"`,
`response: null`, `cancelled: true`, and both IDs. It renders as **Deferred (AFK)**,
not legacy Cancelled. The additive `ask:deferred` event includes question,
context, options, reason, and IDs; it never emits `ask:answered` or `ask:cancelled`.
Ordinary events retain their payloads with additive IDs. Deferral is not human
approval and supplies no permission, policy, or request budget.

Listeners and per-call timers are cleaned up on completion and session shutdown
(including reload/replacement); no processes or timers start in the extension
factory. Consumers should unsubscribe their reply listeners and apply a bounded
local deadline when waiting for responses. See `tests/README.md` for local,
offline verification and the terminal fixture.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).