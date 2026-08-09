# Upstream extraction map

Source: [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) at commit `896bf5f33e0b67bdd0cf951c82739a28e75d0823`.

## Preserved contracts

| Upstream contract | Standalone result |
|---|---|
| `/advisor` control surface | Preserved as `/advisor on`, `off`, `status`, `reload`, `dump`, and `config`. |
| One or more named advisors | Preserved through `WATCHDOG.yml` advisor entries. |
| Advisor-specific models and instructions | Preserved. Model selectors accept a thinking suffix. |
| `WATCHDOG.md` review priorities | Preserved for user and trusted project levels. |
| Default investigative tools | Adapted from OMP `read`, `grep`, and `glob` to Pi `read`, `grep`, `find`, and `ls`. |
| `advise` tool with three severities | Preserved. |
| Duplicate and filler suppression | Adapted from the upstream emission guard. |
| Bounded catch-up and provider failures | Adapted to a five-slot queue, per-update timeout, and one to three attempts. |
| Transcript rewrite reset | Preserved for compaction and tree navigation. |
| Mid-session enable seed | Preserved. Existing history is not replayed. |
| Late concern preservation | Preserved. |
| Late blocker continuation | Preserved in interactive modes. Headless modes preserve the card. |
| Headless final drain | Adapted to a maximum 60-second wait. |
| Project-specific advisor instructions | Preserved with explicit Pi project trust. |
| Distinct advisor message card | Preserved with a Pi extension renderer. |

## Internalized dependencies

- Transcript delta tracking
- Read-only tool construction and execution
- Model loop and usage accounting
- Severity routing
- Note normalization and XML escaping
- Strict YAML discovery and merge rules
- Cancellation, timeout, retry, and stale-callback guards

## Replaced dependencies

| OMP dependency | Replacement |
|---|---|
| OMP `Agent` and `SessionAdvisors` internals | Public `ctx.modelRegistry.complete()` plus a local bounded tool loop |
| OMP model roles | Per-advisor model selector, top-level selector, or current Pi model |
| OMP `glob` tool | Pi `find` tool |
| OMP YieldQueue | `pi.sendMessage()` with `steer`, `followUp`, or immediate delivery |
| OMP secret obfuscator | Bounded transcript extraction plus best-effort common-secret redaction |
| OMP status line and command registry | Pi `setStatus()` and `registerCommand()` |
| OMP configuration overlay | Strict YAML plus `/advisor config` guidance |
| OMP private context compaction | Clear and re-prime when context reaches the character limit |

## Removed scope

- Mutating advisor tools
- Cursor server-side execution bridge
- MCP resources inside advisor sessions
- OMP service tiers
- OMP retry-fallback chains and credential rotation
- Advisor support for OMP task subagents
- OMP Agent Hub integration
- Separate `__advisor*.jsonl` persistence and stats ingestion
- Full-screen `WATCHDOG.yml` editor
- Provider-specific unsafe-output quarantine

These removals avoid private OMP interfaces and unsafe grants. They keep the standalone package installable against public Pi releases.

## Compatibility decisions

- Keep the `/advisor` command name.
- Keep `WATCHDOG.yml`, `WATCHDOG.yaml`, and `WATCHDOG.md` names.
- Keep `nit`, `concern`, and `blocker` values.
- Normalize legacy `search` to `grep` and `glob` to `find`.
- Use package name `@jeecabs/pi-advisor` because another package uses the unscoped npm name.
- Require Pi `0.84.0` or later.

## Validation baseline

The upstream emission-guard tests passed in the source checkout. The upstream config test could not start without the monorepo workspace dependencies. This was an environment setup failure, not an observed behavior failure.

The standalone package has contract tests for configuration, trust, transcript limits, redaction, and tool use. Other tests cover note delivery, retry, cancellation, headless drain, and session enable behavior.
