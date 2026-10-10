# @sketch-test/format-detector

> Auto-detect import format — the first stage of the import pipeline

## Role

Examines unknown content and identifies its format (OpenAPI, Postman Collection, Postman Environment, HAR, cURL) with a confidence score. Used by the Control Plane's import endpoint to route content to the correct adapter without requiring the user to specify the format.

## Detection targets

| Format | Detector | Key signals |
|--------|----------|-------------|
| `openapi` | `detectOpenApi()` | `openapi` field, `swagger` field, `info.version` |
| `postman-collection` | `detectPostman()` | `info.schema` matching Postman URL, `item` array |
| `postman-environment` | `detectPostman()` | `values` array with `key`/`value`/`enabled` |
| `har` | `detectHar()` | `log.entries` array, `log.version` |
| `curl` | `detectCurl()` | String content matching cURL command syntax |

## API

```typescript
import { detectFormat, type DetectionResult } from '@sketch-test/format-detector';

// Returns ALL matching formats, sorted by confidence descending.
// Content can be a parsed JSON object or a raw string.
const results: DetectionResult[] = detectFormat(content);
// [
//   { format: 'postman-collection', confidence: 0.95, version: '2.1', label: 'Postman Collection v2.1' },
//   { format: 'openapi', confidence: 0.30, label: 'OpenAPI' },  // lower-confidence match
// ]
```

Each result includes:
- `format` — the detected ImportFormat
- `confidence` — 0–1 score
- `version` — detected version string (if available)
- `label` — human-readable format name
- `details` — optional metadata (endpointCount, hasAuth, hasVariables)

## Design invariants

1. **Returns all matches, not just the best** — a Postman Collection containing an OpenAPI reference would match both.
2. **Confidence is advisory** — the caller decides the threshold for auto-routing vs. asking the user.
3. **No false negatives for valid inputs** — well-formed specs must be detected by at least one detector.

## Dependencies

None — zero runtime dependencies. Detection is pure structural inspection.

## When to modify

- **Add a new format**: Add a detector function in `src/detectors/` and register it in `detectFormat()`.
- **Tune confidence scores**: Adjust thresholds in individual detectors based on false-positive reports.
