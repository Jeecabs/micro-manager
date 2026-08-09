# Origin and standalone boundary

The Micro Manager is an independent Pi extension derived from the MIT-licensed review feature in [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi), source commit `896bf5f33e0b67bdd0cf951c82739a28e75d0823`.

The implementation retains bounded background review, named review models, and severity-aware notes. It also retains duplicate suppression, read-only investigation, late-result delivery, and project-specific priorities.

It replaces all upstream runtime integration with public Pi APIs and local modules. The package has no run-time import, build dependency, service dependency, transcript format dependency, or configuration dependency on oh-my-pi.

The package excludes mutating tools, Cursor bridges, MCP resources, service tiers, and credential rotation. It also excludes task-agent hooks, Agent Hub, private compaction, separate review transcripts, and full-screen configuration UI.

Only required MIT attribution and independently adapted review logic remain. Tests cover the adapted logic.
