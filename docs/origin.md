# Origin and standalone boundary

The Micro Manager is an independent Pi extension. It derives from the MIT-licensed review feature in [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) at source commit [`896bf5f33e0b67bdd0cf951c82739a28e75d0823`](https://github.com/can1357/oh-my-pi/commit/896bf5f33e0b67bdd0cf951c82739a28e75d0823).

## Adapted behavior

The implementation retains these review concepts and selected logic:

- Bounded background review.
- Named review models.
- Severity-aware notes.
- Duplicate and filler suppression.
- Read-only investigation.
- Late-result delivery.
- Project-specific review priorities.

The code has changed to fit Pi's public extension surface and this package's smaller scope. Tests in this repository cover the adapted behavior.

## Standalone implementation

This package replaces upstream runtime integration with public Pi APIs and local modules. It has no run-time import, build dependency, service dependency, transcript format dependency, or configuration dependency on oh-my-pi.

The package does not require oh-my-pi to install, start, configure, update, or remove The Micro Manager.

## Excluded upstream scope

This package does not include:

- Mutating review tools.
- Cursor bridges.
- MCP resources.
- Service tiers or credential rotation.
- Task-agent hooks or Agent Hub integration.
- Private compaction integration.
- Separate review transcript persistence.
- A full-screen configuration interface.

These exclusions define the current package boundary. They are not compatibility promises for either project.

## License records

The repository keeps the required copyright and permission text in [`LICENSE.md`](../LICENSE.md). It records the adapted source and source commit in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

See [`docs/architecture.md`](./architecture.md) for the current module and API boundary.
