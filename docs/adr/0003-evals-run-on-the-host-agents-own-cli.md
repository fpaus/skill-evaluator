# 3. Evals run on the host agent's own CLI

Date: 2026-10-23. Status: accepted.

## Context

Waza runs evals on GitHub Copilot only. A skill behaves differently per agent, so a skill invoked from Claude Code should be tested on Claude Code, from opencode on opencode, and so on, including agents added later.

Probes on 2026-10-23: Claude Code and opencode both run headless from inside another agent and accept the prompt on stdin. When a project skill and a global skill share a name, Claude Code loads the global one and opencode the project one. Claude Code's auto-mode classifier blocks a child agent started with `--dangerously-skip-permissions`.

## Decision

- `scripts/run-evals.mjs` is agent-agnostic. Each agent is one entry of data in `scripts/agents.json`: command, continue flags, model flags, prompt channel, a regex that detects the skill firing, and where the final answer sits in the JSON output.
- Evaluate the installed skill, not a copy, because skill precedence differs per agent.
- Graders use only what every agent exposes: exit code, final text, files in the working folder, the trigger regex, and an LLM judge that is the same agent in a separate run. Tool-call grading needs a parser per agent and stays out.
- Permissions use narrow modes (`acceptEdits`, `accept-edits`), never a skip-all flag.

## Consequences

- Adding Copilot CLI or Codex is an `agents.json` entry plus one verifying run.
- Global user instructions (for example a `~/.claude/CLAUDE.md`) still apply during evals; results reflect the user's real setup, not a clean room.
- Old-versus-new comparisons need config isolation per agent and are not supported.
- Every trial costs a real agent run.
- Each trial leaves a session in the agent's store (needed for `continue`).
- The runner sets `PWD` to the trial folder: opencode reads its folder from `$PWD`, and a run with the parent's `PWD` audited the wrong project.
- Windows: the runner refuses `prompt: "arg"` (cmd.exe would parse it); Windows runs are not yet verified.
