# Third-party notices

## can1357/oh-my-pi

The Micro Manager adapts MIT-licensed concepts and selected review logic from [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi), source commit `896bf5f33e0b67bdd0cf951c82739a28e75d0823`.

Adapted behavior includes bounded background review, severity-aware reports, duplicate and filler suppression, read-only investigation, and late-result delivery.

The complete MIT copyright and permission notice is in [LICENSE.md](./LICENSE.md). The package does not import or require oh-my-pi at run time.

## eemeli/yaml

[`src/vendor/yaml.js`](./src/vendor/yaml.js) bundles [`yaml`](https://github.com/eemeli/yaml) 2.9.0 so that both hosts parse configuration without an npm dependency. `pnpm vendor:yaml` rebuilds it.

```text
Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```
