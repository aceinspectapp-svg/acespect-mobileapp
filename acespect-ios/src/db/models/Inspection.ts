import { Model, Query } from '@nozbe/watermelondb';
import { Associations } from '@nozbe/watermelondb/Model';
import { field, date, readonly, children } from '@nozbe/watermelondb/decorators';
import type { Photo } from './Photo';
import type { Driveway } from './Driveway';

/** One inspection job (local copy; `serverId` links to the backend row once synced). */
export class Inspection extends Model {
  static table = 'inspections';

  static associations: Associations = {
    photos: { type: 'has_many', foreignKey: 'inspection_id' },
    driveways: { type: 'has_many', foreignKey: 'inspection_id' },
  };

  @field('server_id') serverId: string | null;
  @field('inspection_type') inspectionType: string;
  @field('property_type') propertyType: string;
  @field('status') status: string;
  @date('started_at') startedAt: Date | null;
  @readonly @date('created_at') createdAt: Date;
  @readonly @date('updated_at') updatedAt: Date;

  @children('photos') photos: Query<Photo>;
  @children('driveways') driveways: Query<Driveway>;
}
