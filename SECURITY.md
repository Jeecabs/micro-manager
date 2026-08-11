# Security policy

## Supported versions

Before the first release, security fixes land on `main`. After the first release, only the latest release receives security fixes.

## Report a vulnerability

Do not put vulnerability details, private transcripts, credentials, or proof-of-concept code in a public issue.

Use [GitHub private vulnerability reporting](https://github.com/Jeecabs/micro-manager/security/advisories/new) when the form is available. If the form is unavailable, open a public issue titled `Security contact request`. Include no technical details. A maintainer will arrange a private channel.

Useful reports include:

- The affected version or commit.
- The expected security boundary.
- Minimal reproduction steps.
- The effect of the defect.
- A proposed fix, if available.

Relevant boundaries include workspace path confinement, secret redaction, project trust, prompt-injection resistance, and stale report delivery.

Maintainers aim to acknowledge a private report within seven days. They will coordinate disclosure after a fix is available.
