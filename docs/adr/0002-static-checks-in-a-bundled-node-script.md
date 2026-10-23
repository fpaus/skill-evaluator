# 2. Static checks run in a bundled Node script

Date: 2026-10-23. Status: accepted.

## Context

The research in `docs/research/analyzers.md` found checks a script decides better than an LLM: frontmatter schema, size budgets, links, hidden Unicode, secrets, script hygiene. Frontmatter rules differ by host: the agentskills.io spec and Codex reject unknown fields, while Claude Code and opencode ignore them.

## Decision

- `scripts/check.mjs` holds the deterministic rules. It needs Node 20 and nothing else; the install path (`npx skills`) already requires Node.
- Frontmatter is checked against every host profile at once, because a published skill runs on all of them. Strict hosts report high severity; lenient hosts report low.
- Hybrid rules (injection phrasing, tool permissions, load-time and destructive commands) emit **flags**. The LLM analyzer decides whether each one is real, so a document that only discusses an attack is not reported.
- Tests live in `tests/`, outside the shipped skill folder.

## Consequences

- The skill gains a Node dependency for this step; without Node it runs the LLM analyzer alone.
- Token counts are approximate (characters / 4).
- New hosts or rules mean editing the profile tables in `check.mjs`.
