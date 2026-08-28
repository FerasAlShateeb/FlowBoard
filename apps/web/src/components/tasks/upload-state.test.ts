import { describe, expect, it } from 'vitest';

import {
  formatFileSize,
  hasActiveUploads,
  initialUploadState,
  uploadReducer,
  type UploadAction,
  type UploadItem,
} from '@/components/tasks/upload-state';

/**
 * The dropzone's state machine.
 *
 * WHAT THESE TESTS BUY: the three-step upload (presign → PUT → confirm) runs
 * concurrently per file, so the awkward cases are all ORDERING cases — a
 * progress event arriving after a dismiss, a late failure for an upload that
 * already succeeded, two files settling out of order. Reached through a rendered
 * dropzone, each of those needs a mocked XHR and a fake timer; reached through
 * the reducer, each is one line.
 */

/** Applies a sequence, so a test reads as the story it is describing. */
function run(actions: UploadAction[], from: readonly UploadItem[] = initialUploadState) {
  return actions.reduce<UploadItem[]>((state, action) => uploadReducer(state, action), [...from]);
}

const START: UploadAction = { type: 'start', id: 'u1', fileName: 'a.png', sizeBytes: 2048 };

describe('uploadReducer', () => {
  it('appends a fresh row at 0%', () => {
    expect(run([START])).toEqual([
      { id: 'u1', fileName: 'a.png', sizeBytes: 2048, progress: 0, status: 'uploading' },
    ]);
  });

  it('advances progress, clamped to 0–100 and rounded', () => {
    const state = run([START, { type: 'progress', id: 'u1', percent: 41.6 }]);
    expect(state[0]?.progress).toBe(42);

    const over = run([START, { type: 'progress', id: 'u1', percent: 250 }]);
    expect(over[0]?.progress).toBe(100);

    const nan = run([START, { type: 'progress', id: 'u1', percent: Number.NaN }]);
    expect(nan[0]?.progress).toBe(0);
  });

  it('pins a succeeded row at 100%', () => {
    const state = run([
      START,
      { type: 'progress', id: 'u1', percent: 60 },
      { type: 'succeed', id: 'u1' },
    ]);
    expect(state[0]).toMatchObject({ status: 'done', progress: 100 });
  });

  it('keeps the last progress value on failure, so the bar does not jump', () => {
    const state = run([
      START,
      { type: 'progress', id: 'u1', percent: 60 },
      { type: 'fail', id: 'u1' },
    ]);
    expect(state[0]).toMatchObject({ status: 'error', progress: 60 });
  });

  it('IGNORES a progress event that lands after the upload finished', () => {
    // The confirm step resolves while a final `upload.onprogress` is still in
    // flight; without the status guard the finished row would slide backwards.
    const state = run([
      START,
      { type: 'succeed', id: 'u1' },
      { type: 'progress', id: 'u1', percent: 40 },
    ]);
    expect(state[0]).toMatchObject({ status: 'done', progress: 100 });
  });

  it('IGNORES a late failure for a row that already succeeded', () => {
    const state = run([START, { type: 'succeed', id: 'u1' }, { type: 'fail', id: 'u1' }]);
    expect(state[0]?.status).toBe('done');
  });

  it('is a no-op for an id it does not hold', () => {
    // A progress event for a row the user already dismissed must not resurrect
    // it — the row is gone because they said so.
    const state = run([
      START,
      { type: 'dismiss', id: 'u1' },
      { type: 'progress', id: 'u1', percent: 90 },
    ]);
    expect(state).toEqual([]);
  });

  it('replaces rather than duplicates when the same id starts twice', () => {
    const state = run([START, { type: 'progress', id: 'u1', percent: 50 }, START]);
    expect(state).toHaveLength(1);
    expect(state[0]?.progress).toBe(0);
  });

  it('tracks several files independently and settles them in any order', () => {
    const state = run([
      START,
      { type: 'start', id: 'u2', fileName: 'b.pdf', sizeBytes: 10 },
      { type: 'succeed', id: 'u2' },
      { type: 'fail', id: 'u1' },
    ]);
    expect(state.map((item) => [item.id, item.status])).toEqual([
      ['u1', 'error'],
      ['u2', 'done'],
    ]);
  });

  it('clearSettled keeps only what is still transferring', () => {
    const state = run([
      START,
      { type: 'start', id: 'u2', fileName: 'b.pdf', sizeBytes: 10 },
      { type: 'succeed', id: 'u2' },
      { type: 'clearSettled' },
    ]);
    expect(state.map((item) => item.id)).toEqual(['u1']);
  });

  it('never mutates the array it was handed', () => {
    const before = run([START]);
    const snapshot = structuredClone(before);
    uploadReducer(before, { type: 'succeed', id: 'u1' });
    expect(before).toEqual(snapshot);
  });
});

describe('hasActiveUploads', () => {
  it('is true only while something is still transferring', () => {
    expect(hasActiveUploads(run([START]))).toBe(true);
    expect(hasActiveUploads(run([START, { type: 'succeed', id: 'u1' }]))).toBe(false);
    expect(hasActiveUploads([])).toBe(false);
  });
});

describe('formatFileSize', () => {
  it('uses binary steps with decimal labels', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25 MB');
  });

  it('never shows a fractional byte, and survives nonsense', () => {
    expect(formatFileSize(999)).toBe('999 B');
    expect(formatFileSize(-1)).toBe('0 B');
    expect(formatFileSize(Number.NaN)).toBe('0 B');
  });
});
