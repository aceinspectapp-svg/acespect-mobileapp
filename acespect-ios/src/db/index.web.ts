import type { Database } from '@nozbe/watermelondb';

/**
 * Web build of the DB module. WatermelonDB's SQLite adapter has no web target
 * (and Metro would otherwise statically pull in its node variant, which needs
 * `better-sqlite3`). Web runs without a local database — this is type-only, so
 * nothing from WatermelonDB is bundled for web.
 */
export const database: Database | null = null;
export const isDatabaseReady = false;
