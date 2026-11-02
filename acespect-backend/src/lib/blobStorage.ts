import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { env } from '../config/env';

/**
 * Azure Blob Storage for photos and report files (the STORAGE_PROVIDER=azure side of lib/storage.ts). The container stays private and
 * is never exposed to clients: the API stores the bytes here and serves them back itself through the signed /api/v1/media links.
 *
 * In Azure the backend signs in as its managed identity (DefaultAzureCredential, role "Storage Blob Data Contributor"); the storage
 * account has shared-key and SAS access switched off, so there is no secret to configure. For local development
 * AZURE_STORAGE_CONNECTION_STRING points at the Azurite emulator instead.
 */
export const azureConfigured = (): boolean => !!env.AZURE_STORAGE_CONNECTION_STRING || !!env.AZURE_STORAGE_ACCOUNT_NAME;

let container: ContainerClient | undefined;

function containerClient(): ContainerClient {
  if (container) return container;
  const service = env.AZURE_STORAGE_CONNECTION_STRING
    ? BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING)
    : new BlobServiceClient(`https://${env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, new DefaultAzureCredential());
  container = service.getContainerClient(env.AZURE_STORAGE_CONTAINER);
  return container;
}

/** Where the data lives, for the start-up log. */
export function azureTarget(): string {
  return env.AZURE_STORAGE_CONNECTION_STRING ? `connection string (emulator), container ${env.AZURE_STORAGE_CONTAINER}` : `${env.AZURE_STORAGE_ACCOUNT_NAME}/${env.AZURE_STORAGE_CONTAINER} (managed identity)`;
}

/** A blob name has no leading slash; the photo index may hold keys written with one. */
const blobName = (key: string): string => key.replace(/^\/+/, '');

/**
 * Checks the container can be reached. With the emulator (connection string) the container is created if missing; in Azure it is
 * provisioned by infrastructure and the managed identity only has data access, so a missing container is an error.
 */
export async function ensureContainer(): Promise<void> {
  const c = containerClient();
  if (env.AZURE_STORAGE_CONNECTION_STRING) {
    await c.createIfNotExists();
    return;
  }
  if (!(await c.exists())) throw new Error(`Azure container "${env.AZURE_STORAGE_CONTAINER}" does not exist in ${env.AZURE_STORAGE_ACCOUNT_NAME}`);
}

export async function putBlob(key: string, buffer: Buffer, contentType: string): Promise<void> {
  await containerClient().getBlockBlobClient(blobName(key)).uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });
}

/** The blob's bytes, or null when it does not exist. Large files are streamed, small ones read whole so the caller can cache them. */
export async function getBlob(key: string): Promise<{ stream: NodeJS.ReadableStream; length: number; contentType: string | undefined } | null> {
  try {
    const res = await containerClient().getBlobClient(blobName(key)).download();
    if (!res.readableStreamBody) return null;
    return { stream: res.readableStreamBody, length: res.contentLength ?? NaN, contentType: res.contentType };
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) return null;
    throw err;
  }
}
