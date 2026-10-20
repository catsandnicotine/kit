export type ConnectionState = 'checking' | 'offline' | 'paused' | 'online';

export interface ConnectionNoticeState {
  connection: ConnectionState;
  visible: boolean;
}
