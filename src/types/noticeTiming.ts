/** Remaining visible reading time; paused time does not consume the budget. */
export interface NoticeClock {
  remainingMs: number;
  runningSince: number | null;
}

/** One visible message's optional automatic-dismiss policy. */
export interface NoticeAutoDismissOptions {
  identity: string;
  visible: boolean;
  delayMs: number | null;
  onDismiss: (() => void) | undefined;
}
