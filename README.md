# The Micro Manager

The Micro Manager shadows a Pi coding session with one or more independent review models. It checks completed turns, investigates concrete risks with read-only tools, and sends concise `nit`, `concern`, or `blocker` notes back to the primary agent.

It is a standalone Pi extension. It uses public Pi APIs and does not require another extension at run time.

## What it does

- Reviews primary-agent turns in a bounded background queue.
- Supports multiple named review models with separate instructions.
- Grants only workspace-confined `read`, `grep`, `find`, and `ls` tools.
- Suppresses duplicate and content-free reports.
- Steers material concerns into an active primary turn.
- Preserves late reports without silently starting a completed headless run.
- Loads user configuration and trusted project configuration.
- Tracks review-model backlog, usage, cost, and failures separately.

## Requirements

- Pi `0.84.0` or later
- Node.js `22.12.0` or later

## Install

```sh
pi install git:github.com/Jeecabs/micro-manager
```

Install a local checkout during development:

```sh
pi install /absolute/path/to/micro-manager
```

Run it once without installation:

```sh
pi --no-extensions -e /absolute/path/to/micro-manager/src/index.ts
```

Pi packages run with your user permissions. Review the source before installation.

## Configure

Create user defaults at:

```text
~/.pi/agent/MICRO_MANAGER.yml
```

Create project configuration at:

```text
<project>/.pi/MICRO_MANAGER.yml
```

Minimal configuration:

```yaml
enabled: true
thinking: low
tools: [read, grep, find, ls]
```

Multiple managers:

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
  Verify every claim against the repository.

managers:
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

A named manager inherits top-level `model`, `thinking`, and `tools` values. A manager without a model uses the primary session model. Configuration can activate at most eight named managers.

`search` is an alias for `grep`. `glob` is an alias for `find`. The parser rejects other tools and unknown configuration keys.

### Review priorities

Put additional review priorities in `MICRO_MANAGER.md`:

```markdown
# Review priorities

- Watch for writes that bypass the durable queue.
- Require renderer text to remove terminal control characters.
- Require a package smoke test before handoff.
```

The extension loads:

- `~/.pi/agent/MICRO_MANAGER.yml`, `.yaml`, and `.md`
- `MICRO_MANAGER.yml`, `.yaml`, and `.md` from the repository root to the current directory
- `.pi/MICRO_MANAGER.yml`, `.yaml`, and `.md` at the same project levels

User files load first. Project files load from the repository root toward the current directory. A more specific named manager replaces an earlier manager with the same normalized name. When both YAML suffixes exist in one location, `.yml` takes precedence.

### Project trust

Project `MICRO_MANAGER` files are repository-controlled prompts. The extension checks only file metadata before trust. It does not read project configuration until Pi grants project trust.

In the TUI, The Micro Manager asks for trust when a root `MICRO_MANAGER` file is the only project resource. For print or JSON mode, grant trust before the run. A saved `/trust` decision works. `--approve` also works when the project contains a standard trust-gated Pi resource, such as `.pi/settings.json`.

## Commands

| Command | Result |
|---|---|
| `/micro-manager status` | Show configuration, models, backlog, token use, cost, and errors. |
| `/micro-manager on` | Enable review for this session without replaying old history. |
| `/micro-manager off` | Stop review for this session. |
| `/micro-manager reload` | Reload configuration and rebuild review runtimes. |
| `/micro-manager dump` | Open the in-memory review transcript in the TUI. |
| `/micro-manager config` | Show configuration paths and an example. |

Enable the default manager for one process:

```sh
pi --micro-manager -p "Review this change."
```

## Delivery behavior

A `nit` waits for a safe message boundary. A `concern` or `blocker` steers an active primary run.

A concern that arrives after a completed answer appears as a card and does not start another primary turn. A blocker can restart an idle interactive turn because it reports broken output.

`immune_turns` limits repeated interruptions. During immunity, later concerns and blockers become non-interrupting notes.

Print and JSON modes buffer reports until the primary agent settles. They wait for final review work for at most 60 seconds and never start a hidden primary turn. JSON mode emits the final micro-manager card. Print mode preserves primary stdout and appends report metadata when Pi persists the session.

## Privacy and safety

The Micro Manager sends a bounded transcript excerpt to each configured review model. The excerpt can include:

- visible user and assistant text.
- tool names and arguments.
- text tool results.
- selected primary context messages.

It excludes hidden reasoning, images, and prior micro-manager messages. Read-tool images become a text omission marker. Best-effort redaction removes common credentials and sensitive argument fields, but it cannot detect every secret.

Each model can read text files and search the trusted workspace with its configured tools. The wrapper rejects paths and symbolic links that resolve outside the workspace. Do not select a model or provider that must not receive project data. A single update cannot exceed half of `max_context_chars`, even when `max_input_chars` is larger.

Review conversations, usage, and errors stay in memory. Visible cards and print-mode report metadata use normal Pi session persistence. The extension writes no separate transcript or analytics database.

## Failure behavior

Background review does not block the TUI. A failed manager shows an error status and releases its backlog. The runner retries according to `max_attempts`. It does not retry after shutdown or session replacement.

Use `/micro-manager status` for the latest failure. Use `/micro-manager reload` after you fix model or configuration problems.

## Remove

```sh
pi remove git:github.com/Jeecabs/micro-manager
```

Remove unused `MICRO_MANAGER.yml`, `MICRO_MANAGER.yaml`, and `MICRO_MANAGER.md` files separately.

## Develop

```sh
pnpm install
pnpm verify
```

`pnpm verify` runs TypeScript checks, tests, and `npm pack --dry-run`.

## Attribution

The implementation adapts MIT-licensed concepts and selected logic from the original review feature in [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md), [LICENSE.md](./LICENSE.md), and the [standalone boundary](./docs/origin.md).
