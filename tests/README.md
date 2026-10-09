# Local CRA-860 validation

No publication, installed-runtime changes, provider calls, credentials, or AoE integration are required.

## Package regressions

From this package root, using Bun 1.2.8:

```sh
bun test index.test.ts single-select-layout.test.ts
npm run check  # npm pack --dry-run; no tarball is published
```

The pre-patch baseline was 58 pass / 7 fail (six missing `onTestFinished` helper failures and one environment-leak follow-on). The test-only reverse-order `afterEach` stack fixes those without a Bun upgrade.

## Companion core

Source tree: `/Users/jws/code/pi-worktrees/CRA-860-targeted-ui`, release base `f07218c4d4bbc12bef056a7058c3dd49dfe41abe` (0.87.1). Dependency setup was `npm ci --ignore-scripts` with an empty HOME and npm config, preserving the lockfile. Its ignored generated catalogs were missing. With supervisor approval, the exact installed 0.87.1 `pi-ai/dist/providers/data` directory was copied read-only into `packages/ai/src/providers/data`. Source:

`/nix/store/bq6jgg09bicwb8hs3dqydwssli33bq1p-pi-core-0.87.1/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data`

SHA-256 manifest and logs are in `/tmp/aoe-afk-development/core-model-data-sha256.txt` and `core-*.log`. `node packages/ai/scripts/check-model-data.ts` validates those assets locally; do not regenerate catalogs through network providers.

From the core `packages/coding-agent` directory:

```sh
env -i PATH="$PATH" HOME=/tmp/aoe-afk-development/npm-home PI_OFFLINE=1 \
  node ../../node_modules/vitest/dist/cli.js --run \
  test/ui-prompt-ownership.test.ts test/extensions-runner.test.ts \
  test/targeted-dialog-cancellation.test.ts test/interactive-tui.test.ts
```

From its root run `npm run check` with the same isolated environment. No `npm run build`, `npm test`, or unrestricted suite is used. Before fixes, the targeted regression ran against stock source: 8 failed / 1 passed (`core-red.log`), reproducing older-overlay removal, early-factory and input/select replacement/focus bugs.

## Actual classic-source terminal fixture

`native-fixture.ts` wraps the real package registration to capture the tool and adds one test-only `/afk-fixture` command. No model prompt is sent. It starts a directory watcher only inside the command. Run the **classic** source entry, not `pi-test.sh` (which selects `experimental/cli.ts`):

```sh
env -i PATH="$PATH" HOME="$ISOLATED_HOME" PI_CODING_AGENT_DIR="$ISOLATED_HOME/agent" \
  PI_OFFLINE=1 PI_TELEMETRY=0 TERM=xterm-256color AFK_FIXTURE_DIR="$FIXTURE_DIR" \
  "$CORE/node_modules/.bin/tsx" --tsconfig "$CORE/tsconfig.json" \
  "$CORE/packages/coding-agent/src/cli.ts" \
  --offline --no-session -ne -ns -np -nc --no-themes -na \
  -e "$PACKAGE/tests/native-fixture.ts"
```

Use a dedicated tmux server/session, empty directories, and `-c /tmp`. Invoke `/afk-fixture options`, `freeform`, or `inline`. Wait for the question to be visible and `opened.json`, then create `$FIXTURE_DIR/defer`. The watcher requests AFK through the event API, never through keys. Wait for `result.json` and the `CRA860 ... finished` terminal notification, using predicates with deadlines. Options/freeform must be accepted with the explicit AFK result. Inline must refuse; the fixture subsequently aborts that call explicitly to finish, so its ordinary cancellation is **not** attributed to AFK. No release files or live settings are modified.

The original driver is `/tmp/aoe-afk-development/run-native-fixture.py`; its log, results and terminal captures remain under `/tmp/aoe-afk-development/native*` for independent review. The D009 rerun driver is `/tmp/aoe-afk-development/attribution-native-fixture.py`, with logs/captures under `attribution-native*`. It uses the same classic source setup and also asserts the actual runner's `exclusive-v1` capability, pending attribution support, and matching `pi-ask-user` interaction owner on exactly one start/end pair. Inline attribution does not change its cancellation refusal; its subsequent test abort is still not an AFK outcome. D009 core tests cover mixed/unowned nesting in both completion orders, immutable validated metadata, and cleanup; package tests cover all UI paths, unsupported markers, spoof rejection, reused tool IDs, and reload token freshness. Logs for focused core tests, the full core check, package Bun tests and pack dry run use the `attribution-` prefix in the same temporary evidence directory.

## Native outcome-order composition

`outcome-order-native.ts` loads this package through the actual source
`ExtensionRunner` and drives real regular/fullscreen native input, select, and
custom-overlay components. It covers ordinary answers, same-turn answer/cancel
before defer, defer from the matching `ui_prompt_end` listener, and a legitimately
earlier defer. Run from the companion core root:

```sh
env -i PATH="$PATH" HOME=/tmp/aoe-afk-development/npm-home PI_OFFLINE=1 \
  node_modules/.bin/tsx --tsconfig tsconfig.json \
  /Users/jws/code/pi-ask-user-worktrees/CRA-860-afk-defer/tests/outcome-order-native.ts
```

The fixture is excluded from package files. These are component/core checks, not integrated AoE acceptance or rollout authorization. Still required: reviewer acceptance, an AoE fixture proving exact accepted deferral can continue while mixed/unrelated UI pauses, native reload qualification, candidate release/pin review, and any separately authorized live pilot.
