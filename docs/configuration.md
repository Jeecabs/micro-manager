# Configuration

The Micro Manager loads YAML settings and Markdown review priorities. User files apply to all projects. Project files apply only in a trusted project.

Pi and Claude Code read the same files with the same rules. They differ only in their user directory and project directory:

| Host | User directory | Project directory |
|---|---|---|
| Pi | `~/.pi/agent` | `.pi` |
| Claude Code | `~/.claude`, or `$CLAUDE_CONFIG_DIR` when set | `.claude` |

A `MICRO_MANAGER.yml` at the repository root applies in both hosts.

## Quick configuration

Create `~/.pi/agent/MICRO_MANAGER.yml` for Pi or `~/.claude/MICRO_MANAGER.yml` for Claude Code:

```yaml
enabled: true
thinking: low
tools: [read, grep, find, ls]
```

When no later file defines named managers, this configuration creates one default manager. It uses the primary session model.

Run `/micro-manager reload` after you change a file in an active session.

## YAML settings

Top-level settings control the extension and all manager runtimes.

| Key | Default | Accepted value | Effect |
|---|---:|---|---|
| `enabled` | `false` | Boolean | Enable review when the session starts. |
| `model` | Host default | Model selector | Set the inherited review model. Pi defaults to the primary model, Claude Code to Sonnet. |
| `thinking` | `low` | Pi thinking level | Set the inherited thinking level. |
| `tools` | All four tools | Tool-name array | Set the inherited investigation tools. |
| `timeout_ms` | `30000` | 1,000 to 120,000 | Limit one provider attempt, including its tool rounds. |
| `max_input_chars` | `24000` | 2,000 to 100,000 | Limit one primary transcript update. |
| `max_output_tokens` | `512` | 64 to 4,096 | Limit each provider response. |
| `max_tool_rounds` | `3` | 0 to 8 | Limit read-only investigation rounds for one update. |
| `max_context_chars` | `100000` | 8,000 to 500,000 | Limit one manager's private conversation. |
| `max_attempts` | `2` | 1 to 3 | Set the number of provider attempts for one update. |
| `immune_turns` | `3` | 0 to 20 | Set non-interrupting turns after an interrupting report. |
| `instructions` | None | Nonempty string | Add shared instructions to every manager. |
| `managers` | None | Manager array | Replace the default manager with named managers. |

Accepted thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Pi clamps the level to the selected model's capabilities.

Accepted tools are `read`, `grep`, `find`, and `ls`. `search` maps to `grep`. `glob` maps to `find`. An empty tool array disables file investigation but keeps the internal `report` tool.

`timeout_ms` covers all model calls and tool work in one attempt. Each retry starts a new timeout.

A primary update cannot exceed half of `max_context_chars`. This rule applies even when `max_input_chars` is larger.

## Model selectors

Use a provider and model ID when you select a model:

```yaml
model: anthropic/claude-sonnet-4-6
```

Add a thinking suffix to override the inherited thinking level:

```yaml
model: anthropic/claude-sonnet-4-6:medium
```

A bare model ID works only when exactly one registered provider has that ID. Use `provider/model` to avoid ambiguity.

In Pi, a manager without `model` follows the primary session model. The extension rebuilds those managers after primary model selection changes. It starts from current history and does not replay earlier turns. In Claude Code, a manager without `model` uses Sonnet.

### Claude Code models

Claude Code reviews through its own model client, so a selector names a Claude model. Without one, managers use Sonnet, and with the default `low` thinking level they run at Claude Code's lowest effort. Name another model to trade cost for depth:

```yaml
model: opus
```

Claude Code accepts an alias such as `haiku`, `sonnet`, or `opus`, or a full model ID. It also accepts `anthropic/<id>`, so a file shared with Pi can use one spelling. A selector for another provider does not resolve, and that manager shows `no_model`.

The thinking level becomes Claude Code's effort setting. `off`, `minimal`, and `low` map to `low`. `medium`, `high`, `xhigh`, and `max` map to the level of the same name.

Claude Code's model call has no native tool calling, so the manager calls tools by replying with one JSON object. Sonnet and Opus follow this reliably. Haiku sometimes wraps the object in prose; the manager still extracts it, but treat Haiku as best effort.

## Named managers

Use named managers for separate review concerns:

```yaml
enabled: true
model: anthropic/claude-sonnet-4-6
thinking: low
tools: [read, grep, find, ls]

instructions: |
  Report only claims supported by repository evidence.

managers:
  - name: Architecture
    thinking: medium
    instructions: |
      Check ownership, state transitions, and module boundaries.

  - name: Tests
    model: openai/gpt-5.4:low
    tools: [read, grep, find]
    instructions: |
      Check regression coverage and failure paths.

  - name: Paused example
    enabled: false
```

Each manager accepts these keys:

| Key | Default | Effect |
|---|---:|---|
| `name` | Required | Set the display name and merge identity. Maximum length is 80 characters. |
| `enabled` | `true` | Start or pause this manager. |
| `model` | Top-level model | Override the model selector. |
| `thinking` | Top-level thinking | Override the thinking level. |
| `tools` | Top-level tools | Override the investigation tools. |
| `instructions` | None | Add instructions after shared instructions. |

When `managers` contains any definitions, the extension does not create the default manager. If all named managers are paused, no review model runs.

Configuration retains at most eight merged manager definitions. If file merging produces more than eight, the extension keeps the eight most specific definitions and reports a warning.

## Markdown priorities

Put project-specific review priorities in `MICRO_MANAGER.md`:

```markdown
# Review priorities

- Check that durable writes finish before success is reported.
- Require terminal text to remove control characters.
- Require a package smoke test before release.
```

The extension wraps each Markdown file as an attention block in the system prompt. It appends all nonempty blocks in load order.

Treat these files as model instructions. Do not put secrets in them.

## File locations and load order

The extension checks these user files first. The examples use Pi's directories; Claude Code uses `~/.claude` and `.claude` in their place.

1. `~/.pi/agent/MICRO_MANAGER.yml` or `MICRO_MANAGER.yaml`
2. `~/.pi/agent/MICRO_MANAGER.md`

For a Git worktree, it then walks from the repository root to the current directory. At each directory, it checks:

1. `MICRO_MANAGER.yml` or `MICRO_MANAGER.yaml`
2. `MICRO_MANAGER.md`
3. `.pi/MICRO_MANAGER.yml` or `.pi/MICRO_MANAGER.yaml`
4. `.pi/MICRO_MANAGER.md`

When both YAML suffixes exist at one location, `.yml` takes precedence. The extension does not read the `.yaml` file at that location.

Later YAML settings replace earlier top-level settings. Shared `instructions` values accumulate in load order.

Manager names use a normalized lowercase identity. A later manager replaces the complete earlier definition with the same identity. The replacement then inherits the final top-level model, thinking level, and tools.

For example, `Architecture`, `architecture`, and `Architecture /` normalize to the same identity. Use stable, distinct names across configuration levels.

Outside a Git worktree, the extension checks only the current directory and its project directory for project files.

## Project trust

Project `MICRO_MANAGER` files are repository-controlled model instructions. They can select providers and grant read-only access to workspace files. The extension requires explicit Pi project trust before it reads their content.

The extension checks file metadata to detect a project configuration. It does not read configuration content during that check.

In the TUI, the extension asks for trust when a root `MICRO_MANAGER` file is the only project resource. A saved `/trust` decision applies to later sessions.

Print and JSON modes cannot show this extension's trust prompt. Grant trust in an interactive session before a headless run. `--approve` can grant trust when the project also contains a standard Pi trust-gated resource, such as `.pi/settings.json`.

In Claude Code, the plugin reads project files whenever it loads, as Claude Code reads a project's `CLAUDE.md`. An interactive session starts only after you accept Claude Code's workspace trust dialog. `claude -p` skips that dialog, as it does for the rest of the project's configuration.

User files do not require project trust.

## Validation and failure rules

The parser rejects:

- Unknown YAML keys.
- Duplicate YAML keys.
- Values with the wrong type.
- Limits outside their accepted range.
- Tools other than the four read-only tools and their aliases.
- Manager names with control or formatting characters.
- YAML files larger than 64 KiB.
- Symbolic links and non-regular configuration files.

A bad file produces a configuration warning. The extension skips that file and continues with other files. Run `/micro-manager status` to see the warning count and loaded source paths.
