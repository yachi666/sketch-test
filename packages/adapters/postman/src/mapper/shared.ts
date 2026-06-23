/**
 * @sketch-test/adapter-postman — Source context for mapping
 *
 * Immutable context threaded through all mapping functions within a single
 * collection import. Carries provenance metadata from the parsed Postman
 * Collection to every produced canonical entity.
 */

import type {
  ContentHash,
  EntityId,
  Instant,
  SemanticVersion,
} from '@sketch-test/contracts-common';

export interface SourceContext {
  sourceId: EntityId;
  sourceLabel: string;
  sourceVersion: SemanticVersion;
  sourceHash: ContentHash;
  ingestedAt: Instant;
}
