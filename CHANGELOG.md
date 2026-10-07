# Changelog

Notable changes to this project will be documented here.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries use the categories from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Standalone Pi extension with bounded background review.
- Multiple named review managers with independent models and instructions.
- Workspace-confined read-only investigation tools.
- Severity-aware, duplicate-suppressed report delivery.
- Session status, configuration, reload, transcript, and enable/disable commands.

- Claude Code plugin with the same review core, configuration files, and commands. Notes wait in the band above the prompt under a face that escalates with severity; the footer face moves its eyes during review and reacts when it ends.

### Changed

- Review behavior lives in a host-neutral core under `src/core`, with Pi and Claude Code adapters under `src/pi` and `src/claude-code`. Pi behavior is unchanged.
- The `yaml` parser ships as a bundled file, so the Pi package has no runtime npm dependencies.

[Unreleased]: https://github.com/Jeecabs/micro-manager/commits/main
