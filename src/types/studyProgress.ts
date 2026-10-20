/** Distinct cards cleared from this session's active queue, not long-term mastery. */
export interface StudyProgress {
  completed: number;
  total: number;
  remaining: number;
  percent: number;
}
