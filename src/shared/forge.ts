/**
 * Forge (ADR-046) clones and runs this repository's scripts, so only a github.com repository is
 * accepted. Its own file so Forge's protected list can cover it (Security.md §17).
 */
export const FORGE_REPO_RE =
  /^(?:https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(?:\.git)?$/;
