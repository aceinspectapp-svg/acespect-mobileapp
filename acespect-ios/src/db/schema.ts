import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * Offline-first schema (WatermelonDB).
 *
 * Mirrors the locked architecture: the device holds inspections, their photos,
 * and section data locally; Express + Supabase sync comes later (the
 * `server_id` / `remote_url` / `synced` columns are placeholders for that).
 *
 * Bump `version` and add a migration when columns change.
 */
export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'inspections',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'inspection_type', type: 'string' },
        { name: 'property_type', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'started_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'photos',
      columns: [
        { name: 'inspection_id', type: 'string', isIndexed: true },
        { name: 'section_key', type: 'string', isIndexed: true },
        { name: 'category', type: 'string', isOptional: true },
        { name: 'file_path', type: 'string' },
        { name: 'caption', type: 'string' },
        { name: 'sort_order', type: 'number' },
        { name: 'captured_at', type: 'number' },
        { name: 'remote_url', type: 'string', isOptional: true },
        { name: 'synced', type: 'boolean' },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'driveways',
      columns: [
        { name: 'inspection_id', type: 'string', isIndexed: true },
        { name: 'availability', type: 'string' },
        { name: 'location', type: 'string' },
        { name: 'material', type: 'string' },
        { name: 'condition', type: 'string' },
        { name: 'notes', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
