import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { envelopeSchema, fail, ok } from './envelope';

const payloadSchema = z.object({ status: z.literal('ok') });

describe('envelopeSchema', () => {
  it('parses a success envelope and narrows to `data`', () => {
    const parsed = envelopeSchema(payloadSchema).parse(ok({ status: 'ok' }));

    expect(parsed.success).toBe(true);
    // The discriminated union is what makes this access legal without a cast.
    if (!parsed.success) throw new Error('expected the success branch');
    expect(parsed.data.status).toBe('ok');
  });

  it('carries pagination meta when present', () => {
    const parsed = envelopeSchema(payloadSchema).parse(
      ok({ status: 'ok' }, { page: 1, pageSize: 25, total: 60, totalPages: 3 }),
    );

    if (!parsed.success) throw new Error('expected the success branch');
    expect(parsed.meta?.totalPages).toBe(3);
  });

  it('parses an error envelope and narrows to `error`', () => {
    const parsed = envelopeSchema(payloadSchema).parse(
      fail({ code: 'TASK_NOT_FOUND', message: 'No such task' }),
    );

    if (parsed.success) throw new Error('expected the error branch');
    expect(parsed.error.code).toBe('TASK_NOT_FOUND');
  });

  it('rejects a success envelope whose payload does not match', () => {
    expect(() =>
      envelopeSchema(payloadSchema).parse({ success: true, data: { status: 'bad' } }),
    ).toThrow();
  });

  it('rejects a body that is neither half of the union', () => {
    expect(() => envelopeSchema(payloadSchema).parse({ data: { status: 'ok' } })).toThrow();
  });
});
