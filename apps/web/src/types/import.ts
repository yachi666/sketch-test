import type { ImportFormat } from '@sketch-test/format-detector';

/**
 * Import configuration passed from ImportDialog to the parent component
 * when the user initiates an API document import.
 */
export interface ImportConfig {
  /** Raw file content as text. */
  content: string;
  /** Original file name selected by the user. */
  fileName: string;
  /** Detected import format (openapi, postman-collection, har, curl, etc.). */
  detectedFormat: ImportFormat;
  /** Postman environment file content (optional, only when Postman format detected). */
  envFileContent?: string;
  /** Import behaviour options. */
  options: {
    /** Import variable definitions from the collection. */
    importVariables: boolean;
    /** Import authentication configurations. */
    importAuth: boolean;
    /** Convert Postman test scripts to platform assertion rules. */
    convertAssertions: boolean;
    /** Convert folder hierarchy to endpoint tags. */
    foldersToTags: boolean;
  };
  /** Strategy for handling duplicate endpoint conflicts. */
  conflictStrategy: 'skip' | 'overwrite' | 'keep-both' | 'decide-per-item';
  /** Which ApiSource this import belongs to. If empty, creates a new source. */
  sourceId?: string;
  /** Name for a new ApiSource when sourceId is not provided. */
  newSourceName?: string;
}
