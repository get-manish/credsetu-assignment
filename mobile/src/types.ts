// Types shared across the mobile app. They mirror the JSON the backend returns.

export interface Loan {
  id: string;
  friend_name: string;
  amount: number;
  due_date: string; // YYYY-MM-DD
  is_repaid: boolean;
  repaid_at: string | null;
  receipt_url: string | null; // path such as /uploads/abc.png
  created_at: string;
  is_overdue: boolean;
}

export interface Summary {
  total_lent: number;
  total_repaid: number;
  outstanding: number;
  overdue_amount: number;
  loan_count: number;
  overdue_count: number;
}

export interface User {
  id: string;
  phone: string;
}

/** Screens that exist in the navigation stack (and the params each one takes). */
export type RootStackParamList = {
  Login: undefined;
  Loans: undefined;
  AddLoan: undefined;
};
