# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| M0 (feasibility) | ✅ Active development |
| Unreleased | ⚠️ Pre-release only |

## Reporting a vulnerability

**Do not open a public issue.** Email security@sketchtest.dev with:

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Suggested fix (if available)

We aim to acknowledge within 48 hours and publish a fix within 7 days.

## Security design

SketchTest follows a "secure by default" principle:

- **Secrets never enter event payloads**: Sensitive headers and JSON fields are redacted to `***REDACTED***` before Runner event upload.
- **Redaction is recursive**: All nested objects and arrays are traversed for sensitive fields.
- **Published versions are immutable**: Historical runs reference exact version snapshots for audit traceability.
- **Runner isolation**: The Runner process can be deployed in a separate trust zone, near the system under test.
- **No Kafka in V1**: Task scheduling uses PostgreSQL persistent tasks — simpler attack surface.

For full architectural security review, see [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md).
