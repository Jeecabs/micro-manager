# Pi Advisor

Pi Advisor runs one or more review models beside the primary Pi agent. Each advisor reviews completed turns and can inspect the workspace. It sends concise guidance back to the primary agent.

This package is an independent port of the advisor feature in [oh-my-pi](https://github.com/can1357/oh-my-pi). It uses public Pi extension and model interfaces. It does not import oh-my-pi at run time.

## What it does

- Reviews each primary turn in a bounded background queue.
- Supports multiple advisors with separate models and instructions.
- Grants only `read`, `grep`, `find`, and `ls` tools.
- Delivers `nit`, `concern`, and `blocker` notes as advisor cards.
- Steers concerns and blockers into a live primary run.
- Preserves late concerns without waking a completed run.
- Lets a late blocker restart an idle interactive run.
- Suppresses duplicate and content-free notes.
- Loads user and trusted project `WATCHDOG.yml` and `WATCHDOG.md` files.
- Keeps advisor model usage separate in `/advisor status`.

## Requirements

- Pi `0.84.0` or later
- Node.js `22.12.0` or later

## Install

Install from Git after the repository exists:

```sh
pi install git:github.com/Jeecabs/pi-advisor
```

Install the local checkout during development:

```sh
pi install /absolute/path/to/pi-advisor
```

Run it once without installation:

```sh
pi --no-extensions -e /absolute/path/to/pi-advisor/src/index.ts
```

Pi packages run with your user permissions. Review the source before installation.

## Configure

Create a user configuration for all projects:

```text
~/.pi/agent/WATCHDOG.yml
```

Create a project configuration for one trusted repository:

```text
<project>/.pi/WATCHDOG.yml
```

Minimal configuration:

```yaml
enabled: true
thinking: low
tools: [read, grep, find, ls]
```

Multiple advisors:

```yaml
enabled: true
model: anthropic/claude-sonnet-4-6
thinking: low
timeout_ms: 30000
max_input_chars: 24000
max_output_tokens: 512
max_tool_rounds: 3
max_context_chars: 100000
max_attempts: 2
immune_turns: 3

instructions: |
  All advisors must verify claims against the repository.

advisors:
  - name: Architecture
    model: anthropic/claude-sonnet-4-6:medium
    tools: [read, grep, find, ls]
    instructions: |
      Watch module seams, ownership, and public-interface growth.

  - name: Tests
    model: openai/gpt-5.4:low
    tools: [read, grep, find]
    instructions: |
      Find untested behavior and weak verification.

  - name: Paused example
    enabled: false
```

An advisor inherits top-level `model`, `thinking`, and `tools` values. If you do not set a model, it uses the primary session model.

Use `search` as an alias for `grep`. Use `glob` as an alias for `find`. The parser rejects other tools.

### Review priorities

Put review priorities in `WATCHDOG.md`:

```markdown
# Review priorities

- Watch for writes that bypass the durable queue.
- Require renderer text to remove terminal control characters.
- Require a real package smoke test before handoff.
```

Pi Advisor can load these files:

- `~/.pi/agent/WATCHDOG.yml`, `.yaml`, and `.md`
- `WATCHDOG.yml`, `.yaml`, and `.md` from the repository root to the current directory
- `.pi/WATCHDOG.yml`, `.yaml`, and `.md` at the same project levels

User files load first. Project files load from the repository root toward the current directory. A more specific advisor entry replaces an earlier entry with the same normalized name.

When both YAML suffixes exist in one location, `.yml` takes precedence.

### Project trust

Project `WATCHDOG` files are repository-controlled prompts. Pi Advisor does not read them before project trust.

In the TUI, Pi Advisor asks for trust when a root `WATCHDOG` file is the only project resource. Approval saves Pi project trust. Other project resources can load after restart.

For print or JSON mode, grant trust before the run. A saved `/trust` decision works. `--approve` also works when the project contains a standard trust-gated Pi resource, such as `.pi/settings.json`.

## Commands

| Command | Result |
|---|---|
| `/advisor status` | Show configuration, models, backlog, token use, cost, and errors. |
| `/advisor on` | Enable advisors for this session. Existing history is not replayed. |
| `/advisor off` | Stop advisors for this session. |
| `/advisor reload` | Reload `WATCHDOG` files and rebuild advisor runtimes. |
| `/advisor dump` | Open the in-memory advisor transcript in the TUI. |
| `/advisor config` | Show configuration paths and an example. |

Use `--advisor` to enable the default advisor for one process:

```sh
pi --advisor -p "Review this change."
```

## Delivery behavior

A `nit` waits until the next safe message boundary. A `concern` or `blocker` steers a live primary run.

A concern that arrives after a completed answer appears as a card. It does not start another primary turn. A blocker can start another interactive turn because it reports broken output.

`immune_turns` limits repeated interruptions. After an interrupt, later concerns and blockers become non-interrupting notes for that number of primary turns.

Print and JSON modes wait for final advisor reviews for at most 60 seconds. They never start a hidden primary turn after the final answer.

## Privacy and safety

Pi Advisor sends a bounded transcript excerpt to each advisor model. The excerpt can include:

- visible user and assistant text.
- tool names and arguments.
- text tool results.
- selected primary context messages.

It excludes hidden reasoning, images, and previous advisor messages. Read-tool images also become a text omission marker. The extension applies best-effort redaction to common credentials and sensitive argument keys. Redaction cannot detect every secret.

Each advisor can read text files and search the trusted workspace with its configured read-only tools. Do not use an advisor model or provider that should not receive project data. A single update cannot exceed half of `max_context_chars`, even when `max_input_chars` is larger.

Advisor conversations stay in memory. Pi Advisor persists only advisory cards in the primary session. It does not write a separate transcript or analytics database.

## Failure behavior

Advisor work does not block the TUI. A failed advisor shows an error status and releases its backlog. The runner retries one bounded update according to `max_attempts`. It does not retry after shutdown or session replacement.

Run `/advisor status` for the latest failure. Run `/advisor reload` after you fix model or configuration problems.

## Remove

```sh
pi remove git:github.com/Jeecabs/pi-advisor
```

Remove unused `WATCHDOG.yml`, `WATCHDOG.yaml`, and `WATCHDOG.md` files separately.

## Develop

```sh
pnpm install
pnpm verify
```

The verification command runs TypeScript checks, tests, and `npm pack --dry-run`.

## Attribution

This package adapts MIT-licensed advisor concepts and selected logic from oh-my-pi. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and [LICENSE.md](./LICENSE.md).
