import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { App } from '../../src/App';
import { emitRevision } from './setup';

test('idle workspace does no periodic requests and resynchronizes after being hidden', async () => {
  let revision = 1;
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const requests = vi.fn(async () => new Response(JSON.stringify({ revision, workspace: null, defaultPath: revision === 1 ? '/first' : '/resumed' }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', requests);
  render(<App />);
  await screen.findByDisplayValue('/first');
  const loaded = requests.mock.calls.length;
  vi.useFakeTimers();
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(requests).toHaveBeenCalledTimes(loaded);
    hidden.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    revision = 2;
    await act(async () => { emitRevision(2); });
    expect(screen.getByDisplayValue('/first')).toBeInTheDocument();
    expect(requests).toHaveBeenCalledTimes(loaded);
    hidden.mockReturnValue(false);
    await act(async () => { fireEvent(document, new Event('visibilitychange')); });
    expect(screen.getByDisplayValue('/resumed')).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

test('notifications arriving during a workspace request trigger a fresh snapshot', async () => {
  let resolve!: (response: Response) => void;
  const json = (revision: number, defaultPath: string) => new Response(JSON.stringify({ revision, workspace: null, defaultPath }), { headers: { 'content-type': 'application/json' } });
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(() => ++calls === 1 ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(json(2, '/newer'))));
  render(<App />);
  await act(async () => { emitRevision(2); resolve(json(1, '/older')); });
  await waitFor(() => expect(screen.getByDisplayValue('/newer')).toBeInTheDocument());
});
