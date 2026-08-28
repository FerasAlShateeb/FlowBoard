// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { AttachmentSection } from '@/components/tasks/AttachmentSection';
import { ATTACHMENTS, IDS, renderWithProviders } from '@/components/tasks/__tests__/test-utils';

/**
 * The dropzone, at the component level.
 *
 * The REDUCER has its own suite (`upload-state.test.ts`) covering the ordering
 * cases; what is asserted here is the wiring between it and the upload
 * callback — that a picked file starts a row, that the progress reported by the
 * presign→PUT→confirm sequence reaches the bar, and that a failure stays on
 * screen until it is dismissed rather than vanishing silently.
 */

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof AttachmentSection>[0]> = {}) {
  const onUpload = vi.fn(() => Promise.resolve(true));
  const onDelete = vi.fn();
  const onResolveUrl = vi.fn(() => Promise.resolve('https://minio.test/signed'));

  renderWithProviders(
    <AttachmentSection
      attachments={ATTACHMENTS}
      currentUserId={IDS.ada}
      canModerate={false}
      canEdit
      isPending={false}
      onUpload={onUpload}
      onDelete={onDelete}
      onResolveUrl={onResolveUrl}
      {...overrides}
    />,
  );

  return { onUpload, onDelete, onResolveUrl };
}

/** The hidden `<input type="file">` behind the "browse" button. */
function fileInput(): HTMLInputElement {
  return screen.getByLabelText('Choose files to attach') as HTMLInputElement;
}

describe('AttachmentSection', () => {
  it('lists what is already attached, humanised', () => {
    setup();

    expect(screen.getByText('rank-growth.pdf')).toBeInTheDocument();
    expect(screen.getByText(/1\.5 KB/u)).toBeInTheDocument();
    expect(screen.getByText(/Added by Ada Lovelace/u)).toBeInTheDocument();
  });

  it('starts an upload from the file picker and shows a progress bar', async () => {
    const user = userEvent.setup();
    // Held open so the in-flight row is observable rather than instantly gone.
    let report: ((percent: number) => void) | undefined;
    const onUpload = vi.fn((_file: File, onProgress: (percent: number) => void) => {
      report = onProgress;
      return new Promise<boolean>(() => undefined);
    });
    setup({ onUpload });

    await user.upload(fileInput(), new File(['x'], 'diagram.png', { type: 'image/png' }));

    expect(onUpload).toHaveBeenCalledTimes(1);
    const bar = await screen.findByRole('progressbar', { name: 'diagram.png' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');

    report?.(45);
    await waitFor(() => {
      expect(bar).toHaveAttribute('aria-valuenow', '45');
    });
  });

  it('keeps a FAILED upload on screen until it is dismissed', async () => {
    const user = userEvent.setup();
    setup({ onUpload: vi.fn(() => Promise.resolve(false)) });

    await user.upload(
      fileInput(),
      new File(['x'], 'broken.bin', { type: 'application/octet-stream' }),
    );

    // A failure that vanished would leave the user believing the file uploaded.
    expect(await screen.findByText('Upload failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByText('Upload failed')).not.toBeInTheDocument();
    });
  });

  it('mints a fresh presigned URL per download click', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { onResolveUrl } = setup();

    await user.click(screen.getByRole('button', { name: /Download rank-growth\.pdf/u }));

    await waitFor(() => {
      expect(onResolveUrl).toHaveBeenCalledWith(IDS.attachment);
    });
    // A signed GET expires, so it is minted on demand and never cached.
    expect(open).toHaveBeenCalledWith('https://minio.test/signed', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('does NOT pre-sign a thumbnail for a non-image row', () => {
    const { onResolveUrl } = setup();
    // Twenty PDFs must not fire twenty signing requests for previews nobody
    // could see.
    expect(onResolveUrl).not.toHaveBeenCalled();
  });

  it('asks before deleting, and only the uploader is offered the option', async () => {
    const user = userEvent.setup();
    const { onDelete } = setup();

    await user.click(screen.getByRole('button', { name: /Delete attachment rank-growth\.pdf/u }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete rank-growth.pdf?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(IDS.attachment);
  });

  it('hides the delete control from someone who is neither uploader nor admin', () => {
    setup({ currentUserId: IDS.grace, canModerate: false });
    expect(screen.queryByRole('button', { name: /Delete attachment/u })).not.toBeInTheDocument();
  });

  it('offers the dropzone only to a writer', () => {
    setup({ canEdit: false });
    expect(screen.queryByText('browse')).not.toBeInTheDocument();
    expect(screen.getByText('rank-growth.pdf')).toBeInTheDocument();
  });
});
