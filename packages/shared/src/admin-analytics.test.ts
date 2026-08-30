// The admin-analytics family (Round 2, W1.0): the shared window query, the
// series point every chart reads, and one parse-success + one parse-failure per
// domain payload. W1.2 builds the five endpoints against exactly these names.
import { describe, expect, it } from 'vitest';

import {
  analyticsActivityByHourSchema,
  analyticsDomainSchema,
  analyticsEngagementSchema,
  analyticsGrowthSchema,
  analyticsOverviewSchema,
  analyticsTrafficSchema,
  analyticsWindowQuerySchema,
  analyticsWorkSchema,
  seriesPointSchema,
  seriesSchema,
} from './admin-analytics.schema';

const NOW = '2026-02-01T10:00:00Z';
const LATER = '2026-02-02T10:00:00Z';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
const PROJECT_ID = '66666666-6666-4666-8666-666666666666';

const SERIES = [
  { t: NOW, value: 3 },
  { t: LATER, value: 0 },
];

/** 24 gap-filled hour buckets — what every engagement payload must carry. */
const BY_HOUR = Array.from({ length: 24 }, (_unused, hour) => ({ hour, value: 0 }));

describe('analytics domains', () => {
  it('lists the four DRILLABLE domains, and not the overview', () => {
    expect(analyticsDomainSchema.options).toEqual(['engagement', 'work', 'traffic', 'growth']);
    expect(analyticsDomainSchema.safeParse('overview').success).toBe(false);
  });
});

describe('the shared analytics window', () => {
  it('accepts an empty query — every field is defaulted server-side', () => {
    expect(analyticsWindowQuerySchema.parse({})).toEqual({});
  });

  it('accepts a full window with an interval', () => {
    expect(analyticsWindowQuerySchema.parse({ from: NOW, to: LATER, interval: 'hour' })).toEqual({
      from: NOW,
      to: LATER,
      interval: 'hour',
    });
  });

  it('rejects a granularity outside the four buckets', () => {
    expect(analyticsWindowQuerySchema.safeParse({ interval: 'second' }).success).toBe(false);
  });

  it('rejects a window bound that is not an instant', () => {
    expect(analyticsWindowQuerySchema.safeParse({ from: 'last tuesday' }).success).toBe(false);
  });
});

describe('series points', () => {
  it('carries a bucket start and a plain number, so ratios and durations fit too', () => {
    expect(seriesPointSchema.parse({ t: NOW, value: 0.42 })).toEqual({ t: NOW, value: 0.42 });
    expect(seriesSchema.parse(SERIES)).toHaveLength(2);
  });

  it('rejects a point with no bucket start', () => {
    expect(seriesPointSchema.safeParse({ value: 1 }).success).toBe(false);
  });
});

describe('overview', () => {
  const overview = {
    users: { total: 12, active30d: 5 },
    orgs: 2,
    projects: 4,
    tasks: { total: 90, completed30d: 11 },
    eventsSeries: SERIES,
    requestsSeries: SERIES,
    errorRate24h: 0.02,
  };

  it('parses the platform KPI payload', () => {
    expect(analyticsOverviewSchema.parse(overview).users.active30d).toBe(5);
  });

  it('rejects an error rate above 1 — it is a fraction, not a percentage', () => {
    expect(analyticsOverviewSchema.safeParse({ ...overview, errorRate24h: 2 }).success).toBe(false);
  });
});

describe('engagement', () => {
  const engagement = {
    mau: 7,
    dauSeries: SERIES,
    signupsSeries: SERIES,
    stickinessSeries: SERIES,
    activityByHour: BY_HOUR,
    eventsByType: [{ type: 'page_view', count: 40 }],
  };

  it('parses the engagement payload', () => {
    expect(analyticsEngagementSchema.parse(engagement).activityByHour).toHaveLength(24);
  });

  it('rejects an hour histogram that dropped its quiet hours', () => {
    expect(analyticsActivityByHourSchema.safeParse(BY_HOUR.slice(0, 20)).success).toBe(false);
  });

  it('rejects an event type outside the closed telemetry vocabulary', () => {
    expect(
      analyticsEngagementSchema.safeParse({
        ...engagement,
        eventsByType: [{ type: 'user_teleported', count: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe('work', () => {
  const work = {
    tasksCreatedSeries: SERIES,
    tasksCompletedSeries: SERIES,
    cycleTimeSeries: SERIES,
    cycleTimePercentiles: { p50: 12.5, p90: 40, p95: null },
    pointsCompletedSeries: SERIES,
    byProject: [
      {
        projectId: PROJECT_ID,
        projectKey: 'FLOW',
        projectName: 'FlowBoard',
        orgId: ORG_ID,
        orgName: 'Acme',
        orgSlug: 'acme',
        created: 9,
        completed: 4,
        cycleTimeHours: 18.25,
        points: 13,
      },
    ],
  };

  it('parses the delivery payload, nullable percentiles included', () => {
    const parsed = analyticsWorkSchema.parse(work);

    expect(parsed.cycleTimePercentiles.p95).toBeNull();
    expect(parsed.byProject[0]?.projectKey).toBe('FLOW');
  });

  it('rejects a project row with no org slug — every row is a link', () => {
    const [row] = work.byProject;
    const { orgSlug: _slug, ...withoutSlug } = row!;

    expect(analyticsWorkSchema.safeParse({ ...work, byProject: [withoutSlug] }).success).toBe(
      false,
    );
  });
});

describe('traffic', () => {
  const traffic = {
    requestsSeries: SERIES,
    errorSeries: SERIES,
    errorRateSeries: SERIES,
    latency: { p50: 12, p90: 40, p95: 55, p99: 120, max: 900 },
    topEndpoints: [
      { method: 'GET', path: '/api/tasks/:taskId', count: 40, avgDurationMs: 12, errorRate: 0 },
    ],
    statusBreakdown: { '2xx': 100, '3xx': 0, '4xx': 3, '5xx': 1 },
  };

  it('parses the traffic payload and reuses the ops endpoint row', () => {
    expect(analyticsTrafficSchema.parse(traffic).topEndpoints[0]?.path).toBe('/api/tasks/:taskId');
  });

  it('rejects a status breakdown missing a class — the legend must not reflow', () => {
    const { '5xx': _server, ...missing } = traffic.statusBreakdown;

    expect(analyticsTrafficSchema.safeParse({ ...traffic, statusBreakdown: missing }).success).toBe(
      false,
    );
  });
});

describe('growth', () => {
  const growth = {
    orgsCreatedSeries: SERIES,
    invitesSentSeries: SERIES,
    invitesAcceptedSeries: SERIES,
    acceptanceRate: 0.5,
    byOrg: [
      {
        orgId: ORG_ID,
        orgName: 'Acme',
        orgSlug: 'acme',
        memberCount: 4,
        projectCount: 2,
        taskCount: 60,
        lastActivityAt: null,
      },
    ],
  };

  it('parses the growth payload, including an org nobody has touched yet', () => {
    expect(analyticsGrowthSchema.parse(growth).byOrg[0]?.lastActivityAt).toBeNull();
  });

  it('rejects an acceptance rate expressed as a percentage', () => {
    expect(analyticsGrowthSchema.safeParse({ ...growth, acceptanceRate: 50 }).success).toBe(false);
  });
});
