# Architecture

## Goal

Run an independent reviewer without patching Pi internals. Keep its tools read-only, its data bounded, and its lifecycle separate from the primary turn.

## Package boundary

The code has one core and two host adapters:

- [`src/core`](../src/core) holds all review behavior. It imports nothing from Pi, Node, or any npm package, and assumes only ES2023 plus `AbortController` and `AbortSignal`. YAML parsing uses [`src/vendor/yaml.js`](../src/vendor/yaml.js), a dependency-free bundle of the `yaml` package that `pnpm vendor:yaml` rebuilds.
- [`src/pi`](../src/pi) adapts the core to Pi. [`src/index.ts`](../src/index.ts) is the Pi extension entry point, and the `pi.extensions` package manifest points to it.
- [`src/claude-code`](../src/claude-code) adapts the core to Claude Code mods. [`hooks/hooks.json`](../hooks/hooks.json) names [`register.tsx`](../src/claude-code/register.tsx), and the repository root is the plugin and its marketplace.

`tsconfig.portable.json` checks the core and the Claude Code adapter with no Node or DOM types, so code that the mod runtime cannot run fails `pnpm check`.

The core keeps one implementation of the review loop, limits, redaction, workspace confinement, and delivery policy for every host. A host supplies a small `MicroManagerHost` port and translates its own events into session calls.

The Pi adapter uses public types and functions from Pi peer dependencies. It does not read private session files or call private compaction APIs. Provider requests pass through Pi's model registry, so Pi keeps responsibility for provider registration and authentication.

The only direct package dependency is `yaml`, which the Pi adapter uses to parse configuration files. Pi packages and `typebox` remain peer dependencies.

## Modules

| Module | Responsibility |
|---|---|
| [`src/core/session.ts`](../src/core/session.ts) | Own one primary session's review: managers, transcript cursor, delivery policy, interruption immunity, headless buffering, and status. Define the `MicroManagerHost` port. |
| [`src/core/runner.ts`](../src/core/runner.ts) | Own one review conversation, queue, model loop, tool execution, retry policy, timeout, and usage. |
| [`src/core/model.ts`](../src/core/model.ts) | Define the `ReviewModel` port: one model step with neutral messages and tool specs. |
| [`src/core/tools.ts`](../src/core/tools.ts) | Define the read-only tool specs and the `Workspace` port. Validate arguments and confine paths before a host runs a tool. |
| [`src/core/config.ts`](../src/core/config.ts) | Validate parsed `MICRO_MANAGER` files and merge them in load order. |
| [`src/core/transcript.ts`](../src/core/transcript.ts) | Track primary history, render deltas, bound input, and redact common secrets. |
| [`src/core/emission-guard.ts`](../src/core/emission-guard.ts) | Suppress duplicate, empty, content-free, and over-budget reports. |
| [`src/core/message-format.ts`](../src/core/message-format.ts) | Normalize notes and make XML-safe primary messages. |
| [`src/core/prompt.ts`](../src/core/prompt.ts) | Build the review system prompt from fixed and configured instructions. |
| [`src/pi/extension.ts`](../src/pi/extension.ts) | Register Pi hooks, the process flag, the command, and the message renderer. Resolve trust, create the session, and map deliveries to Pi messages. |
| [`src/pi/model.ts`](../src/pi/model.ts) | Resolve Pi model selectors and run review steps through Pi's model registry with native tool calling. |
| [`src/pi/workspace.ts`](../src/pi/workspace.ts) | Run Pi's own `read`, `grep`, `find`, and `ls` tools for the core. |
| [`src/pi/transcript.ts`](../src/pi/transcript.ts) | Map Pi session-branch entries to transcript items. |
| [`src/pi/config-files.ts`](../src/pi/config-files.ts) | Discover and read user and trusted project `MICRO_MANAGER` files, and parse YAML. |
| [`src/pi/renderer.ts`](../src/pi/renderer.ts) | Render compact micro-manager cards in the TUI. |
| [`src/core/text-protocol.ts`](../src/core/text-protocol.ts) | Turn one-prompt text completion into a `ReviewModel` with JSON tool calls, for hosts without native tool calling. |
| [`src/core/config-discovery.ts`](../src/core/config-discovery.ts) | Find and read configuration files through a host file-system port, with one load order and one set of file rules. |
| [`src/core/commands.ts`](../src/core/commands.ts) | Run `/micro-manager` actions; hosts only show the result. |
| [`src/claude-code/register.tsx`](../src/claude-code/register.tsx) | Build the engine port from closures over `$`, forward engine events, and draw the note band and footer face. |
| [`src/claude-code/adapter.ts`](../src/claude-code/adapter.ts) | Implement `MicroManagerHost` for one Claude Code session: delivery, status, turn boundaries, and headless settlement. |
| [`src/claude-code/history.ts`](../src/claude-code/history.ts) | Build review evidence from `session.append` rows. |
| [`src/claude-code/workspace.ts`](../src/claude-code/workspace.ts) | Run `read` and `ls` through `$.fs`, and `grep` and `find` through ripgrep. |
| [`src/claude-code/model.ts`](../src/claude-code/model.ts) | Resolve Claude model selectors and run steps through `$.model.complete` with the text protocol. |
| [`src/claude-code/card.ts`](../src/claude-code/card.ts) | Format notes as plain-text notice rows, and pick the face for the worst note. |

`MicroManagerSession` is the main deep module. A host drives it with `turnEnded`, `reset`, `setEnabled`, `configure`, `primaryModelChanged`, `settle`, and `dispose`, and reads `statusText`, `footer`, and `dump`. It hides runners, the transcript cursor, delivery policy, and immunity.

`MicroManagerRunner` sits behind it. It hides provider calls, tool rounds, context limits, retries, and cancellation.

## Host port

A host implements `MicroManagerHost`:

| Member | Pi adapter |
|---|---|
| `resolveModel(selector, thinking)` | Find the model in Pi's registry, or use the primary model. |
| `workspace` | Pi's read-only tools, rooted at the session directory. |
| `history()` | The current session branch, mapped to transcript items. |
| `primary()` | Pi's mode and idle state. |
| `deliver(delivery)` | Send a custom message, follow-up, or steer, or append print-mode metadata. |
| `changed()` | Redraw the footer status. |
| `sleep(ms, signal)` | `setTimeout`. The core has no timers of its own. |

The Claude Code adapter implements the same port:

| Member | Claude Code adapter |
|---|---|
| `resolveModel(selector, thinking)` | A Claude alias or ID for `$.model.complete`; Sonnet when the configuration names none. |
| `workspace` | `$.fs` for `read` and `ls`; ripgrep through `$.process.run` for `grep` and `find`. |
| `history()` | Main-conversation rows from `session.append`, minus thinking, attachments, notices, and its own rows. |
| `primary()` | `-p` when no surface draws; busy between `turn.start` and `turn.complete`. |
| `deliver(delivery)` | The band above the prompt, a notice row for the record, and a hidden user row the model reads, or `$.prompt.submit` to wake. |
| `changed()` | `$.ui.status`. |
| `sleep(ms, signal)` | `$.clock.sleep`. |

A mod may not store or pass `$`. `register.tsx` therefore builds a `ClaudeCodeApi` from closures over the `$` of `session.start`, and the adapter uses only that interface. Tests drive the adapter with an in-memory `ClaudeCodeApi`.

Claude Code's turn boundary is the end of each main-loop model response, in `turn.step`: the response's rows are stored by then, with the previous step's tool results. In `-p`, the final step also waits for review there, because Claude Code stores a headless run's rows only while its turn is open.

Claude Code's live view hides notice rows that a plugin appends; only the verbose transcript draws them. So the adapter draws notes in the band above the prompt (`AbovePrompt`) and its face beside the footer's mode labels (`SessionMode`), and redraws both with `$.ui.invalidate`. The band keeps at most three notes, dropping the oldest of the mildest first, and clears on the person's next prompt. The notice rows stay as the record that the transcript file and `claude -p` keep.

A `ReviewModel` returns each reply with an optional `native` record. The core stores it with the private conversation and hands it back on later steps, so a provider receives its own thinking signatures and reasoning items intact.

## Lifecycle

```text
project_trust
  -> inspect candidate metadata only
  -> ask before project MICRO_MANAGER content loads

session_start
  -> resolve explicit project trust
  -> load and validate MICRO_MANAGER files
  -> resolve review models
  -> create read-only tools and one runner per active manager

turn_end
  -> snapshot the primary branch
  -> render only the new bounded delta
  -> enqueue the delta for each runner
  -> return immediately

background drain
  -> append the update to private in-memory context
  -> call the configured model
  -> execute bounded read-only tool rounds
  -> accept at most one report call
  -> route the note to the primary session

session_compact or session_tree
  -> reset the primary transcript cursor
  -> clear private review context and note history

model_select
  -> rebuild runners that inherit the primary model
  -> seed the transcript cursor at current history

agent_settled in print or JSON mode
  -> wait for final review work, with a 60-second cap
  -> flush a JSON card or append print-mode report metadata

session_shutdown
  -> invalidate callbacks
  -> abort model calls
  -> clear queues and status
```

The `turn_end` hook does not await background review. One slow or failed manager does not block the primary TUI loop or another manager.

## Model seam

The Pi `ReviewModel` calls `ctx.modelRegistry.complete()`. This call preserves Pi provider registration, authentication, headers, and custom model behavior.

Claude Code's `$.model.complete` takes one system prompt and one user message and returns text. The core's text protocol renders the private conversation and tool specs into that prompt and asks for one JSON object of tool calls. It reads the first such object in the reply and ignores any text around it. Tool results return XML-escaped, inside `<tool-result>` elements.

The core supplies its own specs for `read`, `grep`, `find`, and `ls`. It validates model-generated arguments, then rejects paths and symbolic links that resolve outside the trusted workspace, before the host runs a tool. Unknown tools return an error to the review model.

The runner implements the `report` tool locally. It normalizes and filters each note before any primary-session effect. It accepts at most one useful report per update.

## Queue and retry model

Each runner drains its own queue. A drain combines pending updates before the next review call. The queue stores up to five pending slots. Later updates coalesce into the final slot.

A provider failure rolls private context back to its state before the update. The runner then retries the same bounded update. Each attempt gets its own `timeout_ms` budget. Shutdown, reset, and session replacement abort work without another retry.

A final failure records the latest error and releases that update. A later update can run again and clear the error after success.

## Context model

Each runner keeps an in-memory list of neutral review messages. New primary deltas append to this list. Tool calls and results stay in private context so later updates retain review continuity.

Before an update, the runner compares the serialized message estimate with `max_context_chars`. If the update cannot fit, it clears private context and starts with the bounded update. This reset also clears report deduplication because the model lost prior context.

A single update cannot use more than half of `max_context_chars`. Each tool result has a context-derived text limit between 500 and 8,000 characters. Images become omission markers.

The runner does not use private compaction APIs. A clean reset keeps the core independent from any host's session internals.

## Primary transcript cursor

`TranscriptCursor` stores primary entry IDs. Append-only history produces only new entries. A shorter or changed prefix marks a rewrite and causes a bounded replay.

The transcript renderer includes visible user and assistant text, tool calls, text tool results, compaction summaries, and selected primary context. It omits hidden reasoning, images, and prior micro-manager messages.

The extension resets the cursor after compaction and tree navigation. It seeds the cursor after manual enable, configuration reload, and inherited model changes. These actions do not replay old work.

## Delivery policy

| State | `nit` | `concern` | `blocker` |
|---|---|---|---|
| Primary active in TUI or RPC | Follow-up | Steer | Steer |
| Primary idle in TUI or RPC | Visible card | Visible card | Triggered steer |
| Primary idle in JSON | Visible card | Visible card | Visible card |
| Primary idle in print | Session metadata | Session metadata | Session metadata |
| Interruption immunity active | Follow-up or card | Follow-up or card | Follow-up or card |

Headless reports remain buffered while the primary agent runs. This rule prevents hidden continuations. Print mode uses extension session metadata so a custom message cannot replace primary stdout.

The extension escapes note content before it enters primary-model context. The card renderer removes terminal controls from structured details.

## Trust seam

User `MICRO_MANAGER` files are user-controlled and do not require project trust.

Project `MICRO_MANAGER` files are repository-controlled. The extension requires explicit Pi project trust. A root configuration file does not always trigger Pi's built-in trust detector. The extension checks file metadata and asks in the TUI before it reads content.

The extension rejects symbolic links and files larger than 64 KiB. It rejects unknown YAML keys, unsafe tools, invalid types, and out-of-range limits.

## Data limits

| Resource | Limit |
|---|---:|
| Configuration file | 64 KiB |
| Named managers | 8 merged definitions |
| Primary update | Smaller of `max_input_chars` and half of `max_context_chars` |
| Private model context | `max_context_chars`, default 100,000 characters |
| Model output | `max_output_tokens`, default 512 tokens |
| Read-only tool rounds | `max_tool_rounds`, default 3 |
| Provider attempts | `max_attempts`, default 2 |
| One provider attempt | `timeout_ms`, default 30 seconds |
| Executable read-only calls per response | 8 |
| Tool-result text | Context-derived, from 500 to 8,000 characters |
| Pending update slots | 5. Later updates coalesce into the final slot. |
| Headless final wait | 60 seconds maximum |

## Persistence

The extension stores private review context, usage, errors, and recent note identities in memory. It writes no separate transcript or analytics data.

Visible cards and print-mode report metadata use normal Pi session persistence. Session shutdown clears all private runner state.

## Verification map

Tests follow the module boundaries:

- [`tests/config.test.ts`](../tests/config.test.ts) covers validation, merge order, aliases, limits, and symbolic links.
- [`tests/extension.test.ts`](../tests/extension.test.ts) covers registration, delivery, immunity, trust, and headless settlement through the Pi adapter.
- [`tests/runner.test.ts`](../tests/runner.test.ts) covers tools, argument errors, deduplication, retries, limits, timeouts, aborts, and usage with in-memory ports.
- [`tests/pi-model.test.ts`](../tests/pi-model.test.ts) covers the Pi model mapping and provider-reply passthrough.
- [`tests/transcript.test.ts`](../tests/transcript.test.ts) covers deltas, rewrites, redaction, omission, and hard bounds.
- [`tests/workspace-tools.test.ts`](../tests/workspace-tools.test.ts) covers path and symbolic-link confinement.
- [`tests/text-protocol.test.ts`](../tests/text-protocol.test.ts) covers prompt rendering, reply extraction, and escaping.
- [`tests/claude-code.test.ts`](../tests/claude-code.test.ts) covers the Claude Code paths, the band, history, workspace, model selectors, and delivery through an in-memory engine port.
- [`tests/package.test.ts`](../tests/package.test.ts) covers both entry points and the shared version.
- [`tests/renderer.test.ts`](../tests/renderer.test.ts) covers card sanitization and display.

Run `pnpm verify` to execute both TypeScript checks, all tests, and the package dry run. `pnpm check:claude-code` checks `register.tsx` against the engine's types, which Claude Code writes to `.claude-plugin/types` when it loads the checkout.
