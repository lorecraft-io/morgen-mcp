# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Email: nate@lorecraft.io
3. Include: description of the vulnerability, steps to reproduce, and potential impact.
4. You will receive acknowledgment within 48 hours.

## Credential Model

This MCP server uses a Morgen API key stored in a local `.env` file with `chmod 600` permissions. This credential grants full access to your Morgen calendar, events, and tasks.

**If you suspect your credentials have been compromised:**

1. Rotate your Morgen API key at https://platform.morgen.so/developers-api
2. Update the `MORGEN_API_KEY` value in your local `.env` file
3. Re-run the setup wizard: `npx morgen-mcp setup`

## Scope

- Source code in this repository
- Published npm package (`morgen-mcp`)
- GitHub Actions workflows
