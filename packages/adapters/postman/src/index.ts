/**
 * @sketch-test/adapter-postman — Postman Collection v2.1 Adapter
 *
 * Parses Postman Collection v2.1 exports and Postman Environments into
 * the platform's internal types. This is the first stage of a two-stage
 * adapter: the parse stage produces Postman-specific types, and the
 * mapper stage (next task) converts them to CanonicalApiModel.
 *
 * Parsing features:
 * - JSON and JSONC input (tolerant of BOM, comments, trailing commas)
 * - Postman Collection v2.1 validation
 * - Postman Environment parsing
 * - Helpful diagnostics for v1 collections
 * - Detailed error reporting for malformed input
 *
 * Invariants:
 * - Failed parsing always returns null for the parsed output.
 * - All structural issues produce diagnostic entries.
 * - v1 collections get a specific error pointing to the upgrade path.
 */
export { parseCollection } from './parser/collection.js';
export { parseEnvironment } from './parser/environment.js';

