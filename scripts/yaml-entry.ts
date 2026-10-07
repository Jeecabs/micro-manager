// Entry for src/vendor/yaml.js: the one YAML parser both hosts load. Claude Code mods cannot
// resolve npm packages, so it ships as a single dependency-free ES module. Rebuild with
// `pnpm vendor:yaml` after a yaml upgrade.
export { parseDocument } from "yaml";
