# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Unreleased | ⚠️ Pre-release only |

## Reporting a vulnerability

**Do not open a public issue.** Use [GitHub private vulnerability reporting](https://github.com/yachi666/sketch-test/security/advisories/new) with:

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Suggested fix (if available)

The maintainer will assess the report privately and coordinate remediation and disclosure with you. This pre-release project does not offer a guaranteed response or fix SLA.

## Security design

SketchTest follows a "secure by default" principle:

- **Secrets never enter event payloads**: Sensitive headers and JSON fields are redacted to `***REDACTED***` before Runner event upload.
- **Redaction is recursive**: All nested objects and arrays are traversed for sensitive fields.
- **Published versions are immutable**: Historical runs reference exact version snapshots for audit traceability.
- **Runner isolation**: The Runner process can be deployed in a separate trust zone, near the system under test.
- **No Kafka in V1**: Task scheduling uses PostgreSQL persistent tasks — simpler attack surface.

For full architectural security review, see [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md).
