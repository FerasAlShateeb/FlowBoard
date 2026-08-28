/**
 * The attachment dropzone's in-flight state, as a pure reducer.
 *
 * WHY A REDUCER AND NOT `useState` PER FILE. An upload is a three-step dance
 * (presign → PUT to MinIO with progress → confirm) that runs CONCURRENTLY for
 * every file in a drop, and each of those steps can fail independently. Held as
 * component state, the interesting behaviour — a progress event arriving for a
 * file the user already dismissed, two files finishing out of order, a failure
 * that must stay visible while its siblings succeed — is only reachable by
 * mocking XHR inside a rendered tree.
 *
 * As a reducer it is a table of transitions with no React in it at all, which is
 * what makes those four cases four assertions.
 *
 * THE ONE RULE WORTH STATING: every action is a NO-OP on an unknown id. A
 * progress event that arrives after `dismiss` must not resurrect the row, and a
 * late `fail` for an upload that already succeeded must not un-succeed it — both
 * are ordinary consequences of three async steps racing, not bugs to guard
 * against at the call site.
 */

export type UploadStatus = 'uploading' | 'error' | 'done';

/** One file's row in the dropzone while (and just after) it uploads. */
export interface UploadItem {
  /** Client-side id. The attachment row's real id only exists after step 3. */
  id: string;
  fileName: string;
  sizeBytes: number;
  /** 0–100. Stays at its last value when the upload fails. */
  progress: number;
  status: UploadStatus;
}

export type UploadAction =
  | { type: 'start'; id: string; fileName: string; sizeBytes: number }
  /** From `useUploadAttachment`'s `onProgress`. Clamped to 0–100. */
  | { type: 'progress'; id: string; percent: number }
  | { type: 'succeed'; id: string }
  | { type: 'fail'; id: string }
  /** The user dismissed a failed row, or a finished one auto-cleared. */
  | { type: 'dismiss'; id: string }
  /** Drop every row that is no longer in flight — after a list refetch. */
  | { type: 'clearSettled' };

export const initialUploadState: UploadItem[] = [];

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Applies `action` to `state`, returning a NEW array (never mutating). */
export function uploadReducer(state: readonly UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case 'start': {
      // A repeated id replaces the row rather than appending a twin — the same
      // file dropped twice in a row is one upload the user is watching.
      const without = state.filter((item) => item.id !== action.id);
      return [
        ...without,
        {
          id: action.id,
          fileName: action.fileName,
          sizeBytes: action.sizeBytes,
          progress: 0,
          status: 'uploading',
        },
      ];
    }

    case 'progress':
      return state.map((item) =>
        // Only an upload still IN FLIGHT moves: a percentage that lands after
        // the confirm step would otherwise drag a finished row backwards.
        item.id === action.id && item.status === 'uploading'
          ? { ...item, progress: clampPercent(action.percent) }
          : item,
      );

    case 'succeed':
      return state.map((item) =>
        item.id === action.id ? { ...item, status: 'done', progress: 100 } : item,
      );

    case 'fail':
      return state.map((item) =>
        // A failure after success is a late error from an already-finished
        // upload — the row stays done.
        item.id === action.id && item.status !== 'done' ? { ...item, status: 'error' } : item,
      );

    case 'dismiss':
      return state.filter((item) => item.id !== action.id);

    case 'clearSettled':
      return state.filter((item) => item.status === 'uploading');

    default:
      return [...state];
  }
}

/** True while any row is still transferring — what the dropzone's spinner reads. */
export function hasActiveUploads(state: readonly UploadItem[]): boolean {
  return state.some((item) => item.status === 'uploading');
}

/**
 * A byte count as humans read it: `1.4 MB`.
 *
 * Binary units with decimal labels — the convention every file manager uses, and
 * the one `MAX_ATTACHMENT_BYTES` (25 * 1024 * 1024) is expressed in. Digits stay
 * Western in every locale, so the number is formatted with a fixed `en-US`
 * grouping rather than the UI language's.
 */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Whole bytes never show a decimal; everything else shows one.
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toString()} ${SIZE_UNITS[unit] ?? 'B'}`;
}
