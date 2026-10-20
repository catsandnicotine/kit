import { describe, expect, it } from 'vitest';
import { updateConnectionNotice } from './connectionNotice';

describe('connection notice policy', () => {
  it('keeps a routine healthy launch quiet', () => {
    expect(updateConnectionNotice({ connection: 'checking', visible: false }, 'online').visible).toBe(false);
  });
  it('does not reopen dismissed notices on repeat checks', () => {
    const dismissed = { connection: 'offline', visible: false } as const;
    expect(updateConnectionNotice(dismissed, 'offline')).toBe(dismissed);
    expect(updateConnectionNotice(dismissed, 'checking')).toBe(dismissed);
    expect(updateConnectionNotice(dismissed, 'online')).toEqual({ connection: 'online', visible: true });
  });
  it('reports a new outage or problem once', () => {
    expect(updateConnectionNotice({ connection: 'online', visible: false }, 'offline').visible).toBe(true);
    const paused = updateConnectionNotice({ connection: 'online', visible: false }, 'paused');
    expect(paused.visible).toBe(true);
    expect(updateConnectionNotice({ ...paused, visible: false }, 'paused').visible).toBe(false);
    expect(updateConnectionNotice({ ...paused, visible: false }, 'checking').visible).toBe(false);
  });
});
