import { fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { installVisibilityHandling } from '../../src/lib/visibility';

test('native hiding pauses media and marks motion paused without resuming playback automatically', () => {
  const video = document.createElement('video');
  document.body.append(video);
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
  const stop = installVisibilityHandling();
  try {
    document.documentElement.dataset.desktopHidden = 'true';
    fireEvent(window, new Event('ordiff:visibility'));
    expect(pause).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.pageHidden).toBe('true');
    document.documentElement.dataset.desktopHidden = 'false';
    fireEvent(window, new Event('ordiff:visibility'));
    expect(document.documentElement.dataset.pageHidden).toBe('false');
    expect(pause).toHaveBeenCalledOnce();
  } finally {
    stop(); video.remove();
    delete document.documentElement.dataset.desktopHidden;
    delete document.documentElement.dataset.pageHidden;
  }
});
