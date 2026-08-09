# Architecture

## Goal

Run a useful second-opinion agent without patching Pi internals. Keep its tools read-only, its data bounded, and its lifecycle independent from the primary turn.

## Modules

| Module | Responsibility |
|---|---|
| `src/extension.ts` | Register hooks and commands. Resolve trust, models, tools, delivery, and status. |
| `src/advisor-runner.ts` | Own one advisor conversation, queue, model loop, tool execution, retry, timeout, and usage. |
| `src/config.ts` | Discover and validate user and trusted project `WATCHDOG` files. |
| `src/transcript.ts` | Track primary history, render deltas, bound input, and redact common secrets. |
| `src/emission-guard.ts` | Suppress duplicate, empty, content-free, and over-budget notes. |
| `src/advisory-format.ts` | Normalize notes and make XML-safe primary messages. |
| `src/renderer.ts` | Render compact advisor cards in the TUI. |
| `src/prompt.ts` | Build the advisor system prompt from fixed and configured instructions. |

`AdvisorRunner` is the main deep module. Its public interface is `enqueue`, `reset`, `dispose`, `waitForIdle`, `stats`, and `dump`. It hides provider calls, tool loops, context limits, retries, and cancellation.

## Lifecycle

```text
project_trust
  -> inspect candidate metadata only
  -> ask before project WATCHDOG content loads

session_start
  -> resolve explicit project trust
  -> load and validate WATCHDOG files
  -> resolve advisor models
  -> create read-only tools and runners

turn_end
  -> snapshot primary branch
  -> render only the new bounded delta
  -> enqueue each advisor
  -> return immediately

advisor drain
  -> append the update to private in-memory context
  -> call the configured model
  -> execute bounded read-only tool rounds
  -> accept at most one advise call
  -> route the note to the primary session

session_compact or session_tree
  -> reset transcript cursor
  -> clear private advisor context and note history

model_select
  -> rebuild advisors that inherit the primary model
  -> seed the transcript cursor at current history

agent_settled in print or JSON mode
  -> wait for final advisor work, with a 60-second cap

session_shutdown
  -> invalidate callbacks
  -> abort model calls
  -> clear queues and status
```

## Model seam

The runner calls `ctx.modelRegistry.complete()`. This keeps Pi provider registration, authentication, headers, and custom model behavior.

The runner supplies `read`, `grep`, `find`, and `ls` tool definitions from Pi. It validates each model-generated tool argument before execution. Unknown tools return an error to the advisor model.

The runner handles the `advise` tool itself. It normalizes and filters the note before any primary-session effect.

## Context model

Each advisor keeps an in-memory Pi AI message list. New primary deltas append to this list. Tool calls and tool results stay in the advisor context so later updates retain review continuity.

Before an update, the runner compares the current character estimate with `max_context_chars`. If the update cannot fit, it clears the private context and starts with that bounded update. This reset also clears note deduplication because the reviewer lost prior context.

The runner does not run private compaction. This clean reset avoids dependencies on Pi session internals.

## Primary transcript cursor

`TranscriptCursor` stores primary entry IDs. An append-only history produces only new entries. A shorter or changed prefix marks a rewrite and causes a bounded replay.

The extension resets the cursor after compaction and tree navigation. It seeds the cursor after manual enable, configuration reload, and inherited-model changes. These actions do not replay old work.

## Delivery policy

| State | `nit` | `concern` | `blocker` |
|---|---|---|---|
| Primary streaming | Follow-up | Steer | Steer |
| Primary idle in TUI or RPC | Visible card | Visible card | Triggered steer |
| Primary idle in print or JSON | Visible card | Visible card | Visible card |
| Interruption immunity active | Follow-up or card | Follow-up or card | Follow-up or card |

The extension escapes advisory content before it enters the primary model context. The advisor card renders normalized plain text from structured details.

## Trust seam

User `WATCHDOG` files are user-controlled. The extension always permits them.

Project `WATCHDOG` files are repository-controlled. The extension requires explicit Pi project trust. A root `WATCHDOG` file does not always trigger the built-in Pi trust detector. The extension checks file metadata and asks in the TUI before it reads the file.

The extension rejects symbolic links and files larger than 64 KiB. It rejects unknown YAML keys, unsafe tools, invalid types, and out-of-range limits.

## Data limits

- Configuration file: 64 KiB
- Primary update: the smaller of `max_input_chars` and half of `max_context_chars`
- Advisor context: `max_context_chars`, default 100,000 characters
- Model output: `max_output_tokens`, default 512 tokens
- Read-only tool rounds: `max_tool_rounds`, default 3
- Provider attempts: `max_attempts`, default 2
- Update timeout: `timeout_ms`, default 30 seconds
- Tool calls per response: 8 executable read-only calls
- Tool-result text: a context-derived per-result limit. Images become omission markers.
- Pending update slots: 5. Later updates coalesce into the last slot.

## Persistence

The extension stores advisor context, usage, errors, and recent notes in memory. It writes no advisor transcript. Advisory custom messages use normal Pi primary-session persistence.
