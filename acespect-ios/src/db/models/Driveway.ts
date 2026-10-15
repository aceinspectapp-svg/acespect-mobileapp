import { Model, Relation } from '@nozbe/watermelondb';
import { Associations } from '@nozbe/watermelondb/Model';
import { field, date, readonly, relation } from '@nozbe/watermelondb/decorators';
import type { Inspection } from './Inspection';

/**
 * A driveway section record. Minimal first pass — the rich per-crack / per-photo
 * detail currently held in DrivewaySectionScreen local state can be expanded
 * into related tables later.
 */
export class Driveway extends Model {
  static table = 'driveways';

  static associations: Associations = {
    inspections: { type: 'belongs_to', key: 'inspection_id' },
  };

  @field('inspection_id') inspectionId: string;
  @field('availability') availability: string;
  @field('location') location: string;
  @field('material') material: string;
  @field('condition') condition: string;
  @field('notes') notes: string;
  @readonly @date('created_at') createdAt: Date;
  @readonly @date('updated_at') updatedAt: Date;

  @relation('inspections', 'inspection_id') inspection: Relation<Inspection>;
}
