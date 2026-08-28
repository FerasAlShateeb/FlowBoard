import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import type { TelemetryBucket } from './telemetry-range';

/**
 * Hour or day — the granularity of the two request charts.
 *
 * ONLY ON THE REQUESTS PAGE. Everywhere else the bucket is DERIVED from the
 * window (`presetBucket`), because "30 days at minute resolution" is 43 200
 * marks on a 600-pixel canvas and nobody chooses that on purpose. The requests
 * page is the exception: there the granularity is the thing being inspected —
 * an hourly view finds the spike, a daily view shows whether it is a trend.
 *
 * `minute` is deliberately NOT offered. It exists in the contract for a live
 * incident view, and the API refuses any window wide enough to make it
 * expensive; a chip that produces a 400 for two of the three windows would be a
 * control that mostly does not work.
 */
const BUCKETS: readonly Extract<TelemetryBucket, 'hour' | 'day'>[] = ['hour', 'day'];

export function TelemetryBucketToggle({
  value,
  onChange,
  className,
}: {
  value: TelemetryBucket;
  onChange: (next: TelemetryBucket) => void;
  className?: string;
}) {
  const { t } = useTranslation(['admin']);

  const label = (bucket: (typeof BUCKETS)[number]): string =>
    bucket === 'hour' ? t('admin:bucket.hour') : t('admin:bucket.day');

  return (
    <div
      role="group"
      aria-label={t('admin:bucket.label')}
      data-testid="telemetry-bucket-toggle"
      className={cn(
        'flex items-center gap-0.5 rounded-[var(--radius)] border border-border p-0.5',
        className,
      )}
    >
      {BUCKETS.map((bucket) => (
        <Button
          key={bucket}
          type="button"
          size="xs"
          variant={value === bucket ? 'secondary' : 'ghost'}
          aria-pressed={value === bucket}
          onClick={() => {
            onChange(bucket);
          }}
        >
          {label(bucket)}
        </Button>
      ))}
    </div>
  );
}

export default TelemetryBucketToggle;
