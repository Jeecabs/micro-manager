# Third-party notices

## oh-my-pi advisor

This package independently ports the advisor design and selected MIT-licensed logic from [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi). The port uses source from commit `896bf5f33e0b67bdd0cf951c82739a28e75d0823`.

Copied or adapted concepts include:

- advisor system-prompt framing.
- `WATCHDOG.md` and `WATCHDOG.yml` conventions.
- severity-aware advisory messages.
- normalized note deduplication and content-free phrase suppression.
- bounded background review and read-only investigation.

The upstream MIT copyright and permission notice are in [LICENSE.md](./LICENSE.md).

This port does not use oh-my-pi internal runtime modules at run time.
