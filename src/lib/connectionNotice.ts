import type { ConnectionNoticeState, ConnectionState } from '../types/connection';

/**
 * Surface connection changes once; a routine healthy launch stays quiet.
 * @param previous - Current notice, including any dismissal.
 * @param connection - Latest meaningful connection state.
 * @returns The next notice without reopening an unchanged state.
 */
export function updateConnectionNotice(previous: ConnectionNoticeState, connection: ConnectionState): ConnectionNoticeState {
  if (connection === 'checking' || connection === previous.connection) return previous;
  return { connection, visible: !(previous.connection === 'checking' && connection === 'online') };
}
