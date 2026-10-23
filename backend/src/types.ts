// Shared types for the backend.

// A loan row exactly as Postgres returns it from LOAN_COLUMNS (see routes/loans.ts).
// NUMERIC columns arrive as strings because JS numbers can't represent every decimal
// exactly; we convert them to numbers in the mapper before sending JSON.
// due_date is already a 'YYYY-MM-DD' string because we format it with to_char in SQL
// (otherwise the driver would build a JS Date and timezones could shift the day).
export interface LoanRow {
  id: string;
  friend_name: string;
  amount: string;
  due_date: string;
  is_repaid: boolean;
  repaid_at: Date | null;
  receipt_url: string | null;
  created_at: Date;
  is_overdue: boolean;
  days_overdue: number;
}

// Shape sent to clients as JSON.
export interface Loan {
  id: string;
  friend_name: string;
  amount: number;
  due_date: string;
  is_repaid: boolean;
  repaid_at: string | null;
  receipt_url: string | null;
  created_at: string;
  is_overdue: boolean;
  days_overdue: number;
}

export interface Summary {
  total_lent: number;
  total_repaid: number;
  outstanding: number;
  overdue_amount: number;
  loan_count: number;
  overdue_count: number;
}

// Our own error type so handlers can say "respond with 404 and this message".
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Teach TypeScript that authenticated requests carry req.user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}
