/**
 * `putToStorage` — step 2 of the three-step upload, and the only place in the
 * app that talks to `XMLHttpRequest`.
 *
 * WHY IT GETS ITS OWN SUITE. Steps 1 and 3 are ordinary `lib/api` calls covered
 * by the attachment section's component tests; step 2 is a hand-written state
 * machine with FIVE terminal outcomes, four of which are failures. Those
 * failures are exactly what a user hits — MinIO down, a signature mismatch, a
 * cancel button — and none of them are reachable from a happy-path test.
 *
 * The transport is stubbed rather than jsdom's: this file needs to fire
 * `onload` with a chosen status and `onerror` on demand, which is control jsdom
 * does not hand out. `environment: node` therefore stays, and the stub is the
 * whole DOM surface the function touches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import { putToStorage } from '@/hooks/useAttachments';

/** The slice of `XMLHttpRequest` the function under test uses. */
class FakeXhr {
  static last: FakeXhr | null = null;

  status = 200;
  method: string | null = null;
  url: string | null = null;
  sent: unknown = undefined;
  aborted = false;
  readonly headers = new Map<string, string>();

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  /** Drive a progress tick the way the browser would. */
  progress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent);
  }

  /** Complete the request with a status. */
  finish(status: number): void {
    this.status = status;
    this.onload?.();
  }
}

function install(): void {
  FakeXhr.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
}

/** The one request the function opened. */
function xhr(): FakeXhr {
  const request = FakeXhr.last;
  if (!request) throw new Error('putToStorage opened no request');
  return request;
}

/** A `File` stand-in — Node 22 has `File`, but the type/size are all that matter. */
function file(type = 'image/png', size = 1024): File {
  return new File([new Uint8Array(size)], 'shot.png', { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the request it opens', () => {
  it('PUTs straight to the presigned url with no bearer token attached', async () => {
    install();
    const pending = putToStorage('https://minio.local/bucket/key?sig=abc', file());
    const request = xhr();

    expect(request.method).toBe('PUT');
    expect(request.url).toBe('https://minio.local/bucket/key?sig=abc');
    // The whole point of bypassing `lib/api`: this request goes to storage, and
    // an Authorization header would break the presigned signature check.
    expect(request.headers.has('Authorization')).toBe(false);

    request.finish(200);
    await expect(pending).resolves.toBeUndefined();
  });

  it('sends the file s own content type, because the URL was signed for it', async () => {
    install();
    const pending = putToStorage('https://minio.local/k', file('application/pdf'));

    expect(xhr().headers.get('Content-Type')).toBe('application/pdf');

    xhr().finish(204);
    await pending;
  });

  it('falls back to application/octet-stream for a file with no type', async () => {
    install();
    const pending = putToStorage('https://minio.local/k', file(''));

    expect(xhr().headers.get('Content-Type')).toBe('application/octet-stream');

    xhr().finish(200);
    await pending;
  });

  it('sends the file itself as the body', async () => {
    install();
    const payload = file();
    const pending = putToStorage('https://minio.local/k', payload);

    expect(xhr().sent).toBe(payload);

    xhr().finish(200);
    await pending;
  });
});

describe('progress reporting', () => {
  it('reports whole percentages as the bytes go out', async () => {
    install();
    const onProgress = vi.fn();
    const pending = putToStorage('https://minio.local/k', file(), onProgress);

    xhr().progress(0, 200);
    xhr().progress(50, 200);
    xhr().progress(133, 200);

    expect(onProgress.mock.calls.map(([percent]) => percent)).toEqual([0, 25, 67]);

    xhr().finish(200);
    await pending;
  });

  it('always ends on 100, even when the last tick was 99', async () => {
    // The final chunk's progress event is not guaranteed to arrive, and a bar
    // frozen at 99% next to a finished upload is a bug report.
    install();
    const onProgress = vi.fn();
    const pending = putToStorage('https://minio.local/k', file(), onProgress);

    xhr().progress(199, 200);
    xhr().finish(200);
    await pending;

    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it('ignores a tick whose total is unknown rather than dividing by it', async () => {
    install();
    const onProgress = vi.fn();
    const pending = putToStorage('https://minio.local/k', file(), onProgress);

    xhr().progress(10, 0, false);

    expect(onProgress).not.toHaveBeenCalled();

    xhr().finish(200);
    await pending;
  });

  it('is optional — an upload with no reporter still completes', async () => {
    install();
    const pending = putToStorage('https://minio.local/k', file());

    xhr().progress(10, 100);
    xhr().finish(200);

    await expect(pending).resolves.toBeUndefined();
  });
});

describe('the four failure transitions', () => {
  it.each([200, 201, 204, 299])('resolves for a 2xx (%i)', async (status) => {
    install();
    const pending = putToStorage('https://minio.local/k', file());
    xhr().finish(status);
    await expect(pending).resolves.toBeUndefined();
  });

  it.each([400, 403, 404, 500])(
    'rejects a non-2xx (%i) as an ApiError carrying the status',
    async (status) => {
      install();
      const pending = putToStorage('https://minio.local/k', file());
      xhr().finish(status);

      await expect(pending).rejects.toMatchObject({ status, code: 'upload_failed' });
      await expect(pending).rejects.toBeInstanceOf(ApiError);
    },
  );

  it('rejects a transport failure with `storage_unavailable`, distinctly', async () => {
    // A different code from `upload_failed` because they are different advice:
    // one means "storage refused this file", the other "storage is not there".
    install();
    const pending = putToStorage('https://minio.local/k', file());

    xhr().onerror?.();

    await expect(pending).rejects.toMatchObject({ status: 0, code: 'storage_unavailable' });
  });

  it('rejects an abort as a DOMException, NOT as an ApiError', async () => {
    // TanStack Query keys its cancellation handling on `AbortError`. Wrapping
    // a cancel in an ApiError would surface a toast for a button the user
    // pressed on purpose.
    install();
    const controller = new AbortController();
    const pending = putToStorage('https://minio.local/k', file(), undefined, controller.signal);

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(DOMException);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(xhr().aborted).toBe(true);
  });

  it('never sends anything when the signal is ALREADY aborted', async () => {
    // The cancel arrived between the presign and this call. Sending the bytes
    // and aborting a moment later would still upload most of a 20 MB file.
    install();
    const controller = new AbortController();
    controller.abort();

    const pending = putToStorage('https://minio.local/k', file(), undefined, controller.signal);

    expect(xhr().sent).toBeUndefined();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('settles once: a late onload after an abort changes nothing', async () => {
    install();
    const controller = new AbortController();
    const pending = putToStorage('https://minio.local/k', file(), undefined, controller.signal);

    controller.abort();
    xhr().finish(200);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
