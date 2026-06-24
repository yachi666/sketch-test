/**
 * Dataset Service — CRUD for datasets, dataset versions, and data import.
 *
 * Datasets provide parameterized test data: each row feeds into a test case or
 * workflow execution as input variables. Versions are immutable snapshots.
 * Sensitive fields are masked unless explicitly authorized.
 *
 * Supported import formats: JSON arrays and CSV (first row = headers).
 *
 * DB tables: datasets, dataset_versions
 */

import { pool } from '../../db/db.js';
import { datasetId, datasetVersionId } from '../../shared/id.js';

// ── Types ──────────────────────────────────────────────────────────────────────────

export interface Dataset {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface DatasetRow {
  [key: string]: unknown;
}

export interface DatasetVersion {
  id: string;
  datasetId: string;
  version: number;
  rows: DatasetRow[];
  sensitiveFields: string[];
  createdAt: string;
}

// ── Row mappers ────────────────────────────────────────────────────────────────────

function rowToDataset(row: Record<string, unknown>): Dataset {
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    name: row['name'] as string,
    description: row['description'] as string,
    createdAt: formatTimestamp(row['created_at']),
  };
}

function rowToDatasetVersion(row: Record<string, unknown>, maskSensitive = true): DatasetVersion {
  const rows = (row['rows_json'] as DatasetRow[]) ?? [];
  const sensitiveFields = (row['sensitive_fields'] as string[]) ?? [];

  return {
    id: row['id'] as string,
    datasetId: row['dataset_id'] as string,
    version: row['version'] as number,
    rows: maskSensitive ? maskRows(rows, sensitiveFields) : rows,
    sensitiveFields,
    createdAt: formatTimestamp(row['created_at']),
  };
}

function formatTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

// ── Sensitive field masking ────────────────────────────────────────────────────────

const MASK_VALUE = '***MASKED***';

/** Mask sensitive fields in all rows. Returns a new array with masked copies. */
function maskRows(rows: DatasetRow[], sensitiveFields: string[]): DatasetRow[] {
  if (sensitiveFields.length === 0) return rows;
  return rows.map((row) => {
    const masked: DatasetRow = { ...row };
    for (const field of sensitiveFields) {
      if (field in masked) {
        masked[field] = MASK_VALUE;
      }
    }
    return masked;
  });
}

/** Get a version with unmasked sensitive fields (for authorized access). */
export async function getDatasetVersionUnmasked(id: string): Promise<DatasetVersion | null> {
  const result = await pool.query('SELECT * FROM dataset_versions WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return rowToDatasetVersion(result.rows[0], false);
}

// ── Errors ─────────────────────────────────────────────────────────────────────────

export class DatasetNotFoundError extends Error {
  constructor(id: string) {
    super(`Dataset ${id} not found`);
    this.name = 'DatasetNotFoundError';
  }
}

export class DatasetVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Dataset version ${id} not found`);
    this.name = 'DatasetVersionNotFoundError';
  }
}

// ── Dataset CRUD ───────────────────────────────────────────────────────────────────

/** Create a dataset within a workspace. */
export async function createDataset(
  workspaceId: string,
  name: string,
  description?: string,
): Promise<Dataset> {
  const id = datasetId();
  const now = new Date().toISOString();
  const desc = description ?? '';

  await pool.query(
    `INSERT INTO datasets (id, workspace_id, name, description, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, workspaceId, name, desc, now],
  );

  return {
    id,
    workspaceId,
    name,
    description: desc,
    createdAt: now,
  };
}

/** Get a dataset by ID. */
export async function getDataset(id: string): Promise<Dataset | null> {
  const result = await pool.query('SELECT * FROM datasets WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return rowToDataset(result.rows[0]);
}

/** List all datasets in a workspace, newest first. */
export async function listDatasets(workspaceId: string): Promise<Dataset[]> {
  const result = await pool.query(
    `SELECT * FROM datasets WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(rowToDataset);
}

/** Delete a dataset and all its versions. */
export async function deleteDataset(id: string): Promise<void> {
  await pool.query('DELETE FROM dataset_versions WHERE dataset_id = $1', [id]);
  await pool.query('DELETE FROM datasets WHERE id = $1', [id]);
}

// ── Dataset Version CRUD ───────────────────────────────────────────────────────────

/** Create a new version for a dataset. Auto-increments the version number. */
export async function createDatasetVersion(
  datasetId: string,
  rows: DatasetRow[],
  sensitiveFields?: string[],
): Promise<DatasetVersion> {
  // Verify the dataset exists
  const dataset = await getDataset(datasetId);
  if (!dataset) {
    throw new DatasetNotFoundError(datasetId);
  }

  // Get the latest version number
  const latestResult = await pool.query(
    `SELECT version FROM dataset_versions
     WHERE dataset_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [datasetId],
  );
  const nextVersion =
    latestResult.rows.length > 0 ? (latestResult.rows[0].version as number) + 1 : 1;

  const id = datasetVersionId();
  const now = new Date().toISOString();
  const fields = sensitiveFields ?? [];

  await pool.query(
    `INSERT INTO dataset_versions
      (id, dataset_id, version, rows_json, sensitive_fields, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, datasetId, nextVersion, JSON.stringify(rows), JSON.stringify(fields), now],
  );

  return {
    id,
    datasetId,
    version: nextVersion,
    rows,
    sensitiveFields: fields,
    createdAt: now,
  };
}

/** Get a specific dataset version by ID (sensitive fields masked). */
export async function getDatasetVersion(id: string): Promise<DatasetVersion | null> {
  const result = await pool.query('SELECT * FROM dataset_versions WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return rowToDatasetVersion(result.rows[0], true);
}

/** List all versions for a dataset, newest first (sensitive fields masked). */
export async function listDatasetVersions(datasetId: string): Promise<DatasetVersion[]> {
  const result = await pool.query(
    `SELECT * FROM dataset_versions
     WHERE dataset_id = $1
     ORDER BY version DESC`,
    [datasetId],
  );
  return result.rows.map((row) => rowToDatasetVersion(row, true));
}

// ── Data Import ────────────────────────────────────────────────────────────────────

/**
 * Import a dataset from a JSON string (array of objects).
 * Creates the dataset and an initial version in a single operation.
 */
export async function importDatasetFromJson(
  workspaceId: string,
  name: string,
  jsonString: string,
): Promise<{ dataset: Dataset; version: DatasetVersion }> {
  let rows: DatasetRow[];
  try {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON data must be an array of objects');
    }
    rows = parsed as DatasetRow[];
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${err.message}`);
    }
    throw err;
  }

  if (rows.length === 0) {
    throw new Error('JSON data must contain at least one row');
  }

  const dataset = await createDataset(workspaceId, name);
  const version = await createDatasetVersion(dataset.id, rows);

  return { dataset, version };
}

/**
 * Import a dataset from a CSV string.
 * First row is treated as headers. Creates the dataset and initial version.
 *
 * Supports:
 * - Comma-delimited fields
 * - Double-quoted fields (which may contain commas and escaped quotes)
 * - Trimmed whitespace on unquoted values
 */
export async function importDatasetFromCsv(
  workspaceId: string,
  name: string,
  csvString: string,
): Promise<{ dataset: Dataset; version: DatasetVersion }> {
  const { headers, rows } = parseCsv(csvString);

  if (headers.length === 0) {
    throw new Error('CSV data must have at least a header row');
  }

  const datasetRows: DatasetRow[] = rows.map((values) => {
    const row: DatasetRow = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i] ?? '';
      row[key] = i < values.length ? values[i] : '';
    }
    return row;
  });

  const dataset = await createDataset(workspaceId, name);
  const version = await createDatasetVersion(dataset.id, datasetRows);

  return { dataset, version };
}

// ── CSV Parser ─────────────────────────────────────────────────────────────────────

interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

/**
 * Simple but robust CSV parser.
 *
 * Rules:
 * - Fields are separated by commas
 * - Fields may be enclosed in double quotes
 * - Quoted fields may contain commas and escaped double quotes ("" → ")
 * - Newlines within quoted fields are preserved
 * - Leading/trailing whitespace outside quotes is trimmed
 * - Empty lines are skipped
 */
function parseCsv(input: string): CsvParseResult {
  const lines = splitCsvLines(input);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]!);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  return { headers, rows };
}

/** Split CSV content into logical lines, respecting quoted newlines. */
function splitCsvLines(input: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '\n' && !inQuotes) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        lines.push(trimmed);
      }
      current = '';
    } else if (ch === '\r' && !inQuotes) {
    } else {
      current += ch;
    }
  }

  // Flush the last line
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    lines.push(trimmed);
  }

  return lines;
}

/** Parse a single CSV line into fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' && !inQuotes) {
      inQuotes = true;
    } else if (ch === '"' && inQuotes) {
      // Check for escaped quote ("" → ")
      if (i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip the next quote
      } else {
        inQuotes = false;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  // Flush the last field
  fields.push(current.trim());

  return fields;
}
