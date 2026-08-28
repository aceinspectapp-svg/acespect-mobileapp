/**
 * Static config + mock pre-loaded data for the Job Information screen.
 * The job details here stand in for an admin-platform fetch
 * (GET /jobs/:id) until the backend lands.
 */
import { TileOption } from '../components/inspection/ChoiceTile';
import { JobDetails } from '../types/jobSetup';

export const WEATHER_OPTIONS: TileOption[] = [
  { value: 'sunny', label: 'Sunny', icon: 'sunny-outline' },
  { value: 'overcast', label: 'Overcast', icon: 'cloud-outline' },
  { value: 'dry', label: 'Dry', icon: 'reorder-two-outline' },
  { value: 'intermittent_showers', label: 'Intermittent Showers', icon: 'rainy-outline' },
  { value: 'rain', label: 'Rain', icon: 'water-outline' },
  { value: 'other', label: 'Other', icon: 'help-circle-outline' },
];

// The sample job that used to live here (MOCK_JOB_DETAILS) has been removed:
// it pre-filled every real inspection with a fake inspector, client and
// address, which the inspector then had to notice and clear. Job Information
// now starts blank.

// System status is no longer mocked — see src/hooks/useSystemStatus.ts for the
// live device clock / GPS / network / photo-count / offline-storage values.
