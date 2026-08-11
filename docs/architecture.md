# Architecture

## Goal

Run an independent reviewer without patching Pi internals. Keep its tools read-only, its data bounded, and its lifecycle separate from the primary turn.

## Package boundary

[`src/index.ts`](../src/index.ts) is the Pi extension entry point. The `pi.extensions` package manifest points to that TypeScript file.

The package uses public types and functions from Pi peer dependencies. It does not read private session files or call private compaction APIs. Provider requests pass through Pi's model registry, so Pi keeps responsibility for provider registration and authentication.

The only direct package dependency is `yaml`, which parses configuration files. Pi packages and `typebox` remain peer dependencies.

## Modules

| Module | Responsibility |
|---|---|
| [`src/extension.ts`](../src/extension.ts) | Register hooks, the process flag, the command, and the message renderer. Resolve trust, models, delivery, and status. |
| [`src/micro-manager-runner.ts`](../src/micro-manager-runner.ts) | Own one review conversation, queue, model loop, tool execution, retry policy, timeout, and usage. |
| [`src/config.ts`](../src/config.ts) | Discover and validate user and trusted project `MICRO_MANAGER` files. |
| [`src/transcript.ts`](../src/transcript.ts) | Track primary history, render deltas, bound input, and redact common secrets. |
| [`src/emission-guard.ts`](../src/emission-guard.ts) | Suppress duplicate, empty, content-free, and over-budget reports. |
| [`src/message-format.ts`](../src/message-format.ts) | Normalize notes and make XML-safe primary messages. |
| [`src/renderer.ts`](../src/renderer.ts) | Render compact micro-manager cards in the TUI. |
| [`src/prompt.ts`](../src/prompt.ts) | Build the review system prompt from fixed and configured instructions. |
| [`src/workspace-tools.ts`](../src/workspace-tools.ts) | Wrap Pi read-only tools and reject paths that escape the trusted workspace. |

`MicroManagerRunner` is the main deep module. Its interface is `enqueue`, `reset`, `dispose`, `waitForIdle`, `stats`, and `dump`. It hides provider calls, tool rounds, context limits, retries, and cancellation.

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

The runner calls `ctx.modelRegistry.complete()`. This call preserves Pi provider registration, authentication, headers, and custom model behavior.

The runner supplies Pi definitions for `read`, `grep`, `find`, and `ls`. A wrapper rejects paths and symbolic links that resolve outside the trusted workspace. The runner validates model-generated arguments before execution. Unknown tools return an error to the review model.

The runner implements the `report` tool locally. It normalizes and filters each note before any primary-session effect. It accepts at most one useful report per update.

## Queue and retry model

Each runner drains its own queue. A drain combines pending updates before the next review call. The queue stores up to five pending slots. Later updates coalesce into the final slot.

A provider failure rolls private context back to its state before the update. The runner then retries the same bounded update. Each attempt gets its own `timeout_ms` budget. Shutdown, reset, and session replacement abort work without another retry.

A final failure records the latest error and releases that update. A later update can run again and clear the error after success.

## Context model

Each runner keeps an in-memory Pi AI message list. New primary deltas append to this list. Tool calls and results stay in private context so later updates retain review continuity.

Before an update, the runner compares the serialized message estimate with `max_context_chars`. If the update cannot fit, it clears private context and starts with the bounded update. This reset also clears report deduplication because the model lost prior context.

A single update cannot use more than half of `max_context_chars`. Each tool result has a context-derived text limit between 500 and 8,000 characters. Images become omission markers.

The runner does not use private compaction APIs. A clean reset keeps the package independent from Pi session internals.

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
- [`tests/extension.test.ts`](../tests/extension.test.ts) covers registration, delivery, immunity, trust, and headless settlement.
- [`tests/runner.test.ts`](../tests/runner.test.ts) covers tools, deduplication, retries, limits, aborts, and usage.
- [`tests/transcript.test.ts`](../tests/transcript.test.ts) covers deltas, rewrites, redaction, omission, and hard bounds.
- [`tests/workspace-tools.test.ts`](../tests/workspace-tools.test.ts) covers path and symbolic-link confinement.
- [`tests/renderer.test.ts`](../tests/renderer.test.ts) covers card sanitization and display.

Run `pnpm verify` to execute the TypeScript check, all tests, and the package dry run.
