import React from 'react';
import { CheckCircle2, PenLine, Timer } from 'lucide-react';
import MetricCard from '../ui/metric-card';
import { TodayColumns, TodaySection } from './TodayParts';
import { formatDuration } from '../../lib/duration';
import { cn } from '../../lib/utils';
import { figureValue } from '../../lib/today';

/**
 * A department's Today — one component for Laboratory, Ultrasound and X-Ray. [1.77.0]
 *
 * How the day has gone. What is waiting is in "Needs you now", with the button that opens the
 * worklist; it is not repeated here as a figure, so no count appears twice on the screen.
 *
 * Turnaround is payment to release, the same basis as every other turnaround in the app. A target is
 * shown only when the clinic has set one (TURNAROUND_TARGETS). With none set the figure is measured
 * and not judged, which is the honest state; see reportService.
 */
export default function DepartmentToday({ category, ops, analytics, needs, heading }) {
  const row = ops.data?.diagnostics?.byCategory?.find((r) => r.category_name === category);
  const sla = analytics.data?.turnaroundSla?.find((r) => r.category_name === category);
  // No row means nothing was released today, which is a real 0 once the report has answered.
  const answered = Boolean(ops.data?.diagnostics);
  const released = answered ? Number(row?.released) || 0 : undefined;
  const median = !answered ? undefined : released > 0 ? formatDuration(Number(row.median_turnaround_minutes)) : 'None yet';
  const target = sla?.target_minutes;

  const figures = (
    <div data-testid="today-department" data-category={category} className={cn('grid grid-cols-1 gap-3', needs ? 'sm:grid-cols-3 lg:grid-cols-1' : 'sm:grid-cols-3')}>
      <MetricCard label="Released today" value={figureValue(ops, released)} icon={CheckCircle2} tone="green" />
      <MetricCard
        label="Median turnaround"
        value={figureValue(ops, median)}
        icon={Timer}
        tone="indigo"
        captionTone="slate"
        caption={target ? `Target ${target} min, set by the clinic` : 'From payment to release'}
      />
      <MetricCard
        label="Amended today"
        value={figureValue(ops, answered ? Number(row?.amended) || 0 : undefined)}
        icon={PenLine}
        tone="amber"
        captionTone="slate"
        caption="Corrected after release"
      />
    </div>
  );

  return (
    <TodaySection heading={heading}>
      <TodayColumns left={needs} right={figures} />
    </TodaySection>
  );
}
