# 1. The host agent runs the analyzers

Date: 2026-10-23. Status: accepted.

## Context

The analyzers of microsoft/vscode-chat-customizations-evaluation are two LLM prompts behind VS Code infrastructure (`vscode.lm`, a language server, a JSON parser, Problems-panel ranges). We want them from Claude Code, opencode, Antigravity and any future agent.

## Decision

Port the prompts into `ANALYZERS.md` and let the host agent follow them, in a fresh-context subagent when available. No MCP server. Output is a markdown table, not JSON, because no parser reads it. Waza is out of scope: its real executor runs on GitHub Copilot, not on the host agent.

## Consequences

- Works in any agent that loads skills; costs only the host agent's own usage.
- Results vary with the host model; there is no fixed reviewer model.
- Evaluating real behaviour needs a separate eval runner.
