import { describe, expect, it } from 'vitest';
import { taskPrioritySchema, taskTypeSchema } from '@flowboard/shared';

import {
  TASK_PRIORITIES,
  TASK_PRIORITY_ICON,
  TASK_PRIORITY_TONE,
  TASK_TYPES,
  TASK_TYPE_ICON,
  TASK_TYPE_TONE,
} from '@/components/common/task-icons';

/**
 * The vocabulary tables' TOTALITY and ORDER.
 *
 * The rendering is not asserted here — `BoardCard.test.tsx`,
 * `BacklogSections.test.tsx` and `TaskDataTable.test.tsx` all draw these
 * components. What a unit test can prove, and what six divergent copies made
 * impossible to prove, is that every member of both closed enums has a glyph and
 * a tone, and that the orders are the ones every picker in the app relies on.
 *
 * The enum members come from `@flowboard/shared`'s ZOD SCHEMAS rather than from
 * a literal list here: adding a sixth issue type to the contract must fail this
 * suite, and a list copied into the test would silently agree with a table that
 * had also forgotten it.
 */

const TYPES = taskTypeSchema.options;
const PRIORITIES = taskPrioritySchema.options;

describe('task type table', () => {
  it('covers every type in the contract', () => {
    expect([...TASK_TYPES].sort()).toEqual([...TYPES].sort());
    for (const type of TYPES) {
      expect(TASK_TYPE_ICON[type]).toBeDefined();
      expect(TASK_TYPE_TONE[type]).toBeTruthy();
    }
  });

  it('lists types in hierarchy order', () => {
    expect(TASK_TYPES).toEqual(['epic', 'story', 'task', 'bug', 'subtask']);
  });

  it('gives every type a DISTINCT tone', () => {
    // The whole point of the glyph is telling five categories apart at 14px.
    // Two of the six pre-consolidation copies tinted three types the same muted
    // grey, which made the column unreadable at a glance.
    expect(new Set(Object.values(TASK_TYPE_TONE)).size).toBe(TYPES.length);
  });

  it('uses tone CLASSES, never colour literals (checklist §B)', () => {
    for (const tone of Object.values(TASK_TYPE_TONE)) expect(tone).toMatch(/^text-/);
    for (const tone of Object.values(TASK_PRIORITY_TONE)) expect(tone).toMatch(/^text-/);
  });
});

describe('priority table', () => {
  it('covers every priority in the contract', () => {
    expect([...TASK_PRIORITIES].sort()).toEqual([...PRIORITIES].sort());
    for (const priority of PRIORITIES) {
      expect(TASK_PRIORITY_ICON[priority]).toBeDefined();
      expect(TASK_PRIORITY_TONE[priority]).toBeTruthy();
    }
  });

  it('lists priorities HIGHEST first — a triage list is read top-down', () => {
    expect(TASK_PRIORITIES[0]).toBe('highest');
    expect(TASK_PRIORITIES[TASK_PRIORITIES.length - 1]).toBe('lowest');
  });

  it('colours only the urgent ends, so the glyph still means something', () => {
    // A board where every card carries a saturated priority glyph teaches the
    // eye to ignore all of them.
    expect(TASK_PRIORITY_TONE.highest).toBe('text-danger');
    expect(TASK_PRIORITY_TONE.high).toBe('text-warning');
    expect(TASK_PRIORITY_TONE.medium).toBe('text-muted-foreground');
  });
});
