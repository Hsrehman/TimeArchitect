export interface Session {
  _id: string;
  user_id: string;
  start_time: Date;
  end_time?: Date;
  duration?: number;
  status: 'active' | 'completed';
}

export interface SessionTimeUpdate {
  session_id: string;
  user_id: string;
  current_time: number;
}

export interface TotalShiftTimeUpdate {
  user_id: string;
  total_shift_time: number;
} 