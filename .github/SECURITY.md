# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.x (current) | ✅ Active |
| < 0.1.0 | ❌ No |

## Scope

### What IS a security issue

- **Dependency vulnerabilities** — a transitive dependency with a known CVE that could affect mcp-swiss-ng users
- **Parameter injection** — crafted tool arguments that cause unintended behaviour (e.g. SSRF via URL manipulation in tool parameters)
- **Data leakage** — tool responses that inadvertently expose information beyond what the upstream API returns
- **Prototype pollution** — in JSON parsing or argument handling

### What is NOT a security issue

- Upstream API downtime or data quality issues (report to the data provider)
- API rate limiting by upstream providers
- The fact that all APIs are public/zero-auth by design — this is intentional
- MCP protocol questions — see https://modelcontextprotocol.io

## Reporting a vulnerability

**Open a GitHub issue:** https://github.com/netadvanced/mcp-swiss-ng/issues/new

Since mcp-swiss-ng handles no credentials, tokens, or personal data (all upstream APIs are public Swiss open data), public issue reporting is fine. If you believe the issue is sensitive, use GitHub's private vulnerability reporting:

- [Security → Report a vulnerability](https://github.com/netadvanced/mcp-swiss-ng/security/advisories/new)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

## Contributing a fix

This is a community-maintained open-source project. If you find a vulnerability, we'd love your help fixing it:

1. Open a GitHub issue describing the vulnerability
2. Fork the repo and submit a PR with the fix
3. We'll review and merge as quickly as we can

We don't guarantee specific response timelines, but we take security seriously and will address issues as fast as possible.

## Notes

All upstream APIs are public Swiss open data, so the server stores no personal data and needs no API keys.

By default it runs locally over stdio and opens no port. With `--http` (or `MCP_TRANSPORT=http`) it listens on 127.0.0.1 and serves `/mcp` and `/health`. What to know before exposing it:

- Binding to a non-loopback address requires `MCP_AUTH_TOKEN` and `MCP_ALLOWED_HOSTS`; the server refuses to start otherwise. `MCP_AUTH_TOKEN` is the one secret it handles — pass it through the environment, not the command line.
- `MCP_ALLOWED_HOSTS` is the Host allow-list behind the SDK's DNS-rebinding protection. On a loopback bind it defaults to loopback names.
- Sessions are capped (`MCP_MAX_SESSIONS`, default 64) and dropped after 30 minutes idle. Request bodies are capped at 1 MB.
- `MCP_CORS_ORIGIN` is off by default. Setting it to `*` lets any web page reach the server through a visitor's browser.
- An open server is an open proxy onto the upstream Swiss APIs, using your IP and their rate limits.
