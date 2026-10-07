# Troubleshooting

Run this command first in an interactive session:

```text
/micro-manager status
```

The output shows the extension state, loaded configuration, project-trust state, manager models, backlog, usage, cost, and latest errors.

## The extension is disabled

Configuration defaults to `enabled: false`.

Use one of these options:

```text
/micro-manager on
```

```sh
pi --micro-manager
```

```yaml
enabled: true
```

The command and flag affect the current session or process. YAML configuration persists for later sessions.

## The extension is enabled but unavailable

This state means that no manager runtime has a resolved model.

Check these conditions:

1. Make sure the primary session has a model when a manager inherits it.
2. Use a full `provider/model` selector for each explicit model.
3. Remove an unsupported thinking suffix.
4. Make sure at least one named manager has `enabled: true`.
5. Run `/micro-manager reload` after the fix.

A bare model ID resolves only when one registered provider has that ID.

## No report appears

The reviewer intentionally stays silent when it finds no concrete issue. Duplicate and content-free reports are also suppressed.

Review starts after a completed primary-agent turn. Manual enable, configuration reload, and inherited model changes seed current history. They do not review old turns.

Check `/micro-manager status` for a backlog or error. Use `/micro-manager dump` to inspect the manager's in-memory conversation.

## Project configuration is ignored

Status reports `project config: ignored until project trust is granted` when project files exist but are inactive.

Open the project in the Pi TUI and grant trust. A root `MICRO_MANAGER` file can trigger an extension-specific trust prompt. Use `/trust` to manage the saved Pi decision.

Headless modes cannot show the extension-specific prompt. Grant trust in the TUI first. If the project has a standard Pi trust-gated resource, `--approve` can also grant project trust.

After a new trust decision, restart Pi if other project resources must also load.

## Configuration reloads with warnings

The extension rejects unknown keys, unsafe tools, bad types, out-of-range limits, large files, and configuration symbolic links.

Run `/micro-manager status` to get the warning count. The TUI notification shows the first warning with its file path and parser message.

Fix the reported file, then run:

```text
/micro-manager reload
```

The extension skips a bad file and continues to load other configuration files. A more specific file can therefore appear ineffective when validation rejects it.

## A model stays in error

Status shows the latest provider, timeout, output-limit, or tool-loop error for each manager.

1. Confirm that Pi can use the selected provider and model.
2. Check provider credentials and network access.
3. Increase `timeout_ms` if the model or its tool calls need more time.
4. Increase `max_output_tokens` if the response reaches its token limit.
5. Reduce `max_tool_rounds`, thinking level, or manager instructions if work is too large.
6. Run `/micro-manager reload` after configuration changes.

The runner retries one update up to `max_attempts`. It does not retry after shutdown, reset, or session replacement.

## A manager cannot read a path

Manager tools can access only the trusted workspace. The wrapper rejects:

- Absolute paths outside the workspace.
- Parent paths that escape the workspace.
- Symbolic links that resolve outside the workspace.

Keep evidence inside the workspace. Do not grant a manager shell or write access as a workaround. Those tools are not supported.

## Reports interrupt too often

A `concern` or `blocker` can steer an active primary turn. A blocker can also start an interactive correction turn while idle.

Increase `immune_turns` to create a longer non-interrupting period:

```yaml
immune_turns: 5
```

Set it to `0` to disable immunity. During immunity, reports still arrive, queued or shown, without steering.

## Print output has no report text

Print mode preserves primary stdout. The extension stores reports as `micro-manager-report` session metadata instead of appending text to stdout.

JSON mode emits a final micro-manager card. Both headless modes wait for final review work for at most 60 seconds. They do not start hidden primary turns.

Use JSON mode or inspect the saved Pi session when automation must consume report data.

`claude -p` also keeps stdout unchanged. It stores notes as notices in the session transcript and waits at most 8 seconds for the final review, because Claude Code gives a hook 10 seconds.

## Claude Code shows no notes

Run `/plugin` and confirm that `micro-manager` is installed and enabled. If you installed it from a shell during a session, run `/reload-plugins`.

Notes appear as lines in the transcript once delivered. A nit that arrives during a turn waits for that turn to end. Notes from earlier sessions stay in the verbose transcript; press ctrl+o to see them.

A warning line under the prompt names a failed review or an unresolved model. Run `/micro-manager status` for the error. A manager whose model names another provider, such as `openai/gpt-5.4`, cannot review in Claude Code.

`grep` and `find` reviews need ripgrep (`rg`) on `PATH`. Without it, those calls return an error to the manager, which can still use `read` and `ls`.

## Review uses too much time or money

Each named manager has an independent model conversation. More managers increase provider calls and cost.

Use `/micro-manager status` to compare token use and cost. Then apply one or more changes:

- Disable low-value managers.
- Lower the thinking level.
- Reduce `max_input_chars` or `max_context_chars`.
- Reduce `max_tool_rounds`.
- Reduce `max_attempts`.
- Use a less expensive review model.

Small limits can reduce review quality. Change one limit at a time and inspect the resulting reports.

## The in-memory transcript disappeared

The extension clears private manager context after compaction, tree navigation, reload, model rebuild, reset, or shutdown. This behavior prevents stale review context from crossing primary-session history changes.

The extension does not write a separate review transcript database.

## Report a defect

Before opening an issue, run:

```sh
pnpm verify
```

Include these details in the report:

- Pi version and Node.js version.
- Session mode: TUI, print, or JSON.
- Redacted `MICRO_MANAGER.yml` content.
- `/micro-manager status` output.
- Minimal reproduction steps.

Do not include provider credentials, secrets, or a private transcript. Open the report in the repository's GitHub issue tracker.
