import { Model, Relation } from '@nozbe/watermelondb';
import { Associations } from '@nozbe/watermelondb/Model';
import { field, date, readonly, relation } from '@nozbe/watermelondb/decorators';
import type { Inspection } from './Inspection';

/**
 * A captured photo. The image file lives on disk under the app document
 * directory (`inspection-photos/`); this row stores the path + metadata.
 * `remoteUrl` / `synced` are filled in once the file is uploaded to Supabase
 * Storage via the Express sync layer.
 */
export class Photo extends Model {
  static table = 'photos';

  static associations: Associations = {
    inspections: { type: 'belongs_to', key: 'inspection_id' },
  };

  @field('inspection_id') inspectionId: string;
  @field('section_key') sectionKey: string;
  @field('category') category: string | null;
  @field('file_path') filePath: string;
  @field('caption') caption: string;
  @field('sort_order') sortOrder: number;
  @date('captured_at') capturedAt: Date;
  @field('remote_url') remoteUrl: string | null;
  @field('synced') synced: boolean;
  @readonly @date('created_at') createdAt: Date;

  @relation('inspections', 'inspection_id') inspection: Relation<Inspection>;
}
