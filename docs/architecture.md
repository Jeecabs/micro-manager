# Architecture

## Goal

Run a useful second-opinion agent without patching Pi internals. Keep its tools read-only, its data bounded, and its lifecycle independent from the primary turn.

## Modules

| Module | Responsibility |
|---|---|
| `src/extension.ts` | Register hooks and commands. Resolve trust, models, tools, delivery, and status. |
| `src/micro-manager-runner.ts` | Own one review conversation, queue, model loop, tool execution, retries, timeout, and usage. |
| `src/config.ts` | Discover and validate user and trusted project `MICRO_MANAGER` files. |
| `src/transcript.ts` | Track primary history, render deltas, bound input, and redact common secrets. |
| `src/emission-guard.ts` | Suppress duplicate, empty, content-free, and over-budget reports. |
| `src/message-format.ts` | Normalize notes and make XML-safe primary messages. |
| `src/renderer.ts` | Render compact micro-manager cards in the TUI. |
| `src/prompt.ts` | Build the review system prompt from fixed and configured instructions. |
| `src/workspace-tools.ts` | Wrap Pi read-only tools and reject paths that escape the trusted workspace. |

`MicroManagerRunner` is the main deep module. Its public interface is `enqueue`, `reset`, `dispose`, `waitForIdle`, `stats`, and `dump`. It hides provider calls, tool loops, context limits, retries, and cancellation.

## Lifecycle

```text
project_trust
  -> inspect candidate metadata only
  -> ask before project MICRO_MANAGER content loads

session_start
  -> resolve explicit project trust
  -> load and validate MICRO_MANAGER files
  -> resolve review models
  -> create read-only tools and runners

turn_end
  -> snapshot primary branch
  -> render only the new bounded delta
  -> enqueue each runner
  -> return immediately

background drain
  -> append the update to private in-memory context
  -> call the configured model
  -> execute bounded read-only tool rounds
  -> accept at most one report call
  -> route the note to the primary session

session_compact or session_tree
  -> reset transcript cursor
  -> clear private review context and note history

model_select
  -> rebuild runners that inherit the primary model
  -> seed the transcript cursor at current history

agent_settled in print or JSON mode
  -> wait for final review work, with a 60-second cap
  -> flush buffered JSON cards or append print-mode report metadata

session_shutdown
  -> invalidate callbacks
  -> abort model calls
  -> clear queues and status
```

## Model seam

The runner calls `ctx.modelRegistry.complete()`. This preserves Pi provider registration, authentication, headers, and custom model behavior.

The runner supplies the `read`, `grep`, `find`, and `ls` tool definitions from Pi. A wrapper rejects paths and symbolic links that resolve outside the trusted workspace. The runner validates each model-generated argument before execution. Unknown tools return an error to the review model.

The runner handles the `report` tool itself. It normalizes and filters each note before any primary-session effect.

## Context model

Each runner keeps an in-memory Pi AI message list. New primary deltas append to this list. Tool calls and results stay in the private context so later updates retain review continuity.

Before an update, the runner compares the current character estimate with `max_context_chars`. If the update cannot fit, it clears private context and starts with the bounded update. This reset also clears report deduplication because the model lost prior context.

The runner does not use private compaction APIs. A clean reset keeps the package independent from Pi session internals.

## Primary transcript cursor

`TranscriptCursor` stores primary entry IDs. Append-only history produces only new entries. A shorter or changed prefix marks a rewrite and causes a bounded replay.

The extension resets the cursor after compaction and tree navigation. It seeds the cursor after manual enable, configuration reload, and inherited-model changes. These actions do not replay old work.

## Delivery policy

| State | `nit` | `concern` | `blocker` |
|---|---|---|---|
| Primary streaming in TUI or RPC | Follow-up | Steer | Steer |
| Primary idle in TUI or RPC | Visible card | Visible card | Triggered steer |
| Primary idle in JSON | Visible card | Visible card | Visible card |
| Primary idle in print | Session metadata | Session metadata | Session metadata |
| Interruption immunity active | Follow-up or card | Follow-up or card | Follow-up or card |

Headless reports remain buffered while the primary agent runs. This prevents hidden continuations. Print mode uses extension session metadata so a custom message cannot replace the primary stdout result.

The extension escapes note content before it enters primary-model context. The card renderer removes terminal controls from structured details.

## Trust seam

User `MICRO_MANAGER` files are user-controlled and always permitted.

Project `MICRO_MANAGER` files are repository-controlled. The extension requires explicit Pi project trust. A root configuration file does not always trigger the built-in Pi trust detector. The extension checks file metadata and asks in the TUI before it reads content.

The extension rejects symbolic links and files larger than 64 KiB. It rejects unknown YAML keys, unsafe tools, invalid types, and out-of-range limits.

## Data limits

- Configuration file: 64 KiB
- Named managers: 8
- Primary update: smaller of `max_input_chars` and half of `max_context_chars`
- Private model context: `max_context_chars`, default 100,000 characters
- Model output: `max_output_tokens`, default 512 tokens
- Read-only tool rounds: `max_tool_rounds`, default 3
- Provider attempts: `max_attempts`, default 2
- Update timeout: `timeout_ms`, default 30 seconds
- Tool calls per response: 8 executable read-only calls
- Tool-result text: context-derived per-result limit. Images become omission markers.
- Pending update slots: 5. Later updates coalesce into the final slot.

## Persistence

The extension stores private review context, usage, errors, and recent notes in memory. It writes no separate transcript. Visible cards and print-mode report metadata use normal Pi session persistence.
