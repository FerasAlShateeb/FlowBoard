// The instance-configuration family (Round 2, W1.0). Its own file rather than
// an addition to `contracts.test.ts` for the reason that file states about the
// families with logic of their own — and because Round 2's packages run in
// parallel, so a new family gets a new file instead of five agents editing one.
import { describe, expect, it } from 'vitest';

import {
  instanceConfigSchema,
  instanceSettingsSchema,
  orgModeSchema,
  updateInstanceSettingsInputSchema,
} from './instance.schema';

const ORG_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-02-01T10:00:00Z';

describe('org mode', () => {
  it('accepts exactly the two deployment shapes', () => {
    expect(orgModeSchema.parse('multi')).toBe('multi');
    expect(orgModeSchema.parse('single')).toBe('single');
  });

  it('rejects anything else, so a typo cannot silently collapse the switcher', () => {
    expect(orgModeSchema.safeParse('singular').success).toBe(false);
  });
});

describe('instance config', () => {
  it('parses the multi-org shell payload, where there is no default org', () => {
    const parsed = instanceConfigSchema.parse({
      orgMode: 'multi',
      defaultOrgSlug: null,
      instanceName: 'FlowBoard',
    });

    expect(parsed).toEqual({ orgMode: 'multi', defaultOrgSlug: null, instanceName: 'FlowBoard' });
  });

  it('parses a single-org install pointing at its one workspace', () => {
    expect(
      instanceConfigSchema.parse({
        orgMode: 'single',
        defaultOrgSlug: 'acme',
        instanceName: 'Acme Boards',
      }).defaultOrgSlug,
    ).toBe('acme');
  });

  it('rejects a default org that is not a slug', () => {
    expect(
      instanceConfigSchema.safeParse({
        orgMode: 'single',
        defaultOrgSlug: 'Acme Corp',
        instanceName: 'Acme',
      }).success,
    ).toBe(false);
  });
});

describe('instance settings', () => {
  const settings = {
    orgMode: 'single',
    defaultOrgId: ORG_ID,
    defaultOrgSlug: 'acme',
    instanceName: 'Acme Boards',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('carries BOTH the raw id the form binds to and the slug a link needs', () => {
    const parsed = instanceSettingsSchema.parse(settings);

    expect(parsed.defaultOrgId).toBe(ORG_ID);
    expect(parsed.defaultOrgSlug).toBe('acme');
  });

  it('rejects a row missing the resolved slug rather than defaulting it to null', () => {
    const { defaultOrgSlug: _slug, ...withoutSlug } = settings;

    expect(instanceSettingsSchema.safeParse(withoutSlug).success).toBe(false);
  });
});

describe('instance settings update', () => {
  it('requires at least one field', () => {
    expect(updateInstanceSettingsInputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts each field on its own, including clearing the default org', () => {
    expect(updateInstanceSettingsInputSchema.parse({ orgMode: 'multi' })).toEqual({
      orgMode: 'multi',
    });
    expect(updateInstanceSettingsInputSchema.parse({ defaultOrgId: null })).toEqual({
      defaultOrgId: null,
    });
    expect(updateInstanceSettingsInputSchema.parse({ instanceName: 'Acme' })).toEqual({
      instanceName: 'Acme',
    });
  });

  it('rejects a default org addressed by slug — the mode binds to the id', () => {
    expect(updateInstanceSettingsInputSchema.safeParse({ defaultOrgId: 'acme' }).success).toBe(
      false,
    );
  });
});
