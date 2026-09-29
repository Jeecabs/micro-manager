# The Micro Manager

<p align="center">
  <img src="./assets/micro-manager.png" alt="The Micro Manager" width="320">
</p>

The Micro Manager is a Pi extension that reviews completed coding turns in the background. One or more independent models can inspect bounded session updates with read-only tools. They report only a concrete `nit`, `concern`, or `blocker`.

The package uses public Pi APIs. It does not require oh-my-pi or another extension at run time.

## Requirements

- Pi 0.84.0 or later
- Node.js 22.12.0 or later

## Install and start

Install the package from GitHub:

```sh
pi install git:github.com/Jeecabs/micro-manager
```

Pi packages run with your user permissions. Review the source before installation.

The extension is disabled by default. Enable review for one Pi process:

```sh
pi --micro-manager
```

The flag overrides `enabled` for that process. If no named managers exist, the extension creates a default manager. It uses the primary session model, low thinking, and all four read-only tools.

For persistent configuration, create `~/.pi/agent/MICRO_MANAGER.yml`:

```yaml
enabled: true
thinking: low
tools: [read, grep, find, ls]
```

Start Pi, complete a coding turn, and run `/micro-manager status`. The reviewer stays silent when it finds no useful issue.

See [Configuration](./docs/configuration.md) for model selectors, named managers, limits, file precedence, and project trust.

## What it does

- Reviews completed primary-agent turns through a bounded background queue.
- Runs multiple named managers with separate models and instructions.
- Provides workspace-confined `read`, `grep`, `find`, and `ls` tools.
- Suppresses duplicate and content-free reports.
- Steers a material concern into an active primary turn.
- Preserves late reports without silently starting a completed headless run.
- Tracks backlog, token use, cost, and failures for each manager.

The extension does not edit files or run commands for a review model. It does not block a primary TUI turn while review work runs.

## Configure a project

Add project configuration at `.pi/MICRO_MANAGER.yml`:

```yaml
enabled: true
model: anthropic/claude-sonnet-4-6
thinking: low

instructions: |
  Verify every claim against repository evidence.

managers:
  - name: Architecture
    model: anthropic/claude-sonnet-4-6:medium
    tools: [read, grep, find, ls]
    instructions: |
      Check module seams, ownership, and public-interface growth.

  - name: Tests
    model: openai/gpt-5.4:low
    tools: [read, grep, find]
    instructions: |
      Find untested behavior and weak verification.
```

Add repository-specific priorities at `.pi/MICRO_MANAGER.md`:

```markdown
# Review priorities

- Watch for writes that bypass the durable queue.
- Require a focused regression test for each bug fix.
```

Project files can select models, add instructions, and grant models read-only access to workspace files. The extension reads them only after Pi grants project trust.

## Commands

Use these commands in an interactive Pi session:

| Command | Result |
|---|---|
| `/micro-manager` | Show current status. |
| `/micro-manager status` | Show configuration, models, backlog, token use, cost, and errors. |
| `/micro-manager on` | Enable review for this session. Do not replay old history. |
| `/micro-manager off` | Stop review for this session. |
| `/micro-manager reload` | Reload configuration and rebuild manager runtimes. |
| `/micro-manager dump` | Open each manager's in-memory transcript. |
| `/micro-manager config` | Show configuration paths and a small example. |

The process flag overrides `enabled` for one Pi process:

```sh
pi --micro-manager -p "Review this change."
```

## Read the face

The footer shows the manager's face:

| Face | Meaning |
|---|---|
| `(¬_¬ )` | Watching. `×2` shows the number of running managers. |
| `(¬_¬ )` → `( ¬_¬)` | Reviewing. The eyes move until the backlog drains. |
| `(¬_¬) fine.` | The last review found nothing to report. |
| `(-_-) sigh.` | The last review reported a nit. |
| `(¬_¬) hm.` | The last review reported a concern. |
| `(ò_ó) stop.` | The last review reported a blocker. |
| `(-_-) zz` | Review is disabled. |
| `(×_×)` | A manager failed. Run `/micro-manager status`. |
| `(?_?)` | No manager has a model. |

Reactions last five seconds. Report cards use the same faces for their most severe note.

## Report delivery

Delivery depends on severity and primary-agent state:

| Report | Primary agent active | Primary agent idle |
|---|---|---|
| `nit` | Queue a follow-up note. | Show a card. |
| `concern` | Steer the active turn. | Show a card. |
| `blocker` | Steer the active turn. | Start an interactive correction turn. |

`immune_turns` prevents repeated interruption loops. During immunity, later concerns and blockers become follow-up notes or cards.

Print and JSON modes buffer reports until the primary agent settles. They wait for review work for at most 60 seconds. They never start a hidden primary turn. JSON mode emits a final micro-manager card. Print mode keeps primary stdout unchanged and stores report metadata in the Pi session.

See [Architecture](./docs/architecture.md) for lifecycle, context, delivery, and limit details.

## Data and safety

Each manager receives a bounded transcript excerpt. The excerpt can contain:

- Visible user and assistant text.
- Tool names, arguments, and text results.
- Selected primary context messages.

The excerpt excludes hidden reasoning, images, and prior micro-manager messages. Read-tool images become an omission marker. Best-effort redaction removes common credential forms and sensitive argument fields. It cannot detect every secret.

Each configured model can read and search text in the trusted workspace. The tool wrapper rejects paths and symbolic links that resolve outside that workspace. Do not use a model or provider that must not receive project data.

Private review conversations, usage, and errors stay in memory. Visible cards and print-mode report metadata use normal Pi session persistence. The extension writes no separate transcript or analytics database.

## Troubleshoot

Start with:

```text
/micro-manager status
```

The status shows whether review is disabled, active, paused, unavailable, or in error. It also shows loaded files and project-trust state.

See [Troubleshooting](./docs/troubleshooting.md) for missing reports, model resolution, trust, timeout, and headless-mode problems.

## Update or remove

Update installed Pi packages:

```sh
pi update --extensions
```

Remove this package:

```sh
pi remove git:github.com/Jeecabs/micro-manager
```

Remove unused `MICRO_MANAGER.yml`, `MICRO_MANAGER.yaml`, and `MICRO_MANAGER.md` files separately.

## Develop

Run a local checkout once without installation:

```sh
pi --no-extensions -e /absolute/path/to/micro-manager
```

Install dependencies and run all repository checks:

```sh
pnpm install
pnpm verify
```

`pnpm verify` runs the TypeScript check, test suite, and package dry run.

See [Contributing](./CONTRIBUTING.md) for change guidelines. Maintainers must follow the [release procedure](./docs/releasing.md).

## Origin and license

The implementation adapts MIT-licensed concepts and selected logic from the original review feature in [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi). It replaces upstream runtime integration with public Pi APIs and local modules.

See [Origin and standalone boundary](./docs/origin.md), the [changelog](./CHANGELOG.md), and [third-party notices](./THIRD_PARTY_NOTICES.md).

Security reports follow the [security policy](./SECURITY.md). The repository uses the [MIT license](./LICENSE.md).
