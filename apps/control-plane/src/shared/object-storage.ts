import { constants } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface StoredObject {
  body: Uint8Array;
  contentType?: string;
  contentLength: number;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  checkHealth?(): Promise<void>;
}

function safeKey(key: string): string {
  const normalized = path.posix.normalize(key).replace(/^\/+/, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Object key must remain inside the configured store');
  }
  return normalized;
}

export class FileObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  private filePath(key: string): string {
    return path.join(this.root, safeKey(key));
  }

  async put(key: string, body: Uint8Array | string, _contentType: string): Promise<void> {
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string): Promise<StoredObject> {
    const body = await readFile(this.filePath(key));
    return { body, contentLength: body.byteLength };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.filePath(key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async checkHealth(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.R_OK | constants.W_OK);
  }
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
    if (!result.Body) throw new Error(`Object ${key} has no body`);
    const body = await result.Body.transformToByteArray();
    return {
      body,
      contentLength: result.ContentLength ?? body.byteLength,
      ...(result.ContentType ? { contentType: result.ContentType } : {}),
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async checkHealth(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

export function createObjectStore(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  if ((env['NODE_ENV'] ?? 'development') !== 'production') {
    return new FileObjectStore(env['OBJECT_STORE_PATH'] ?? '.sketchtest/objects');
  }
  const endpoint = env['S3_ENDPOINT'];
  const region = env['S3_REGION'];
  const accessKeyId = env['S3_ACCESS_KEY'];
  const secretAccessKey = env['S3_SECRET_KEY'];
  const bucket = env['S3_BUCKET'];
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY and S3_BUCKET are required',
    );
  }
  return new S3ObjectStore(
    new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  );
}

let defaultStore: ObjectStore | undefined;

export function getObjectStore(): ObjectStore {
  defaultStore ??= createObjectStore();
  return defaultStore;
}

export async function objectStorageHealthCheck(
  store: ObjectStore = getObjectStore(),
): Promise<boolean> {
  try {
    await store.checkHealth?.();
    return true;
  } catch {
    return false;
  }
}
