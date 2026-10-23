import axios, { AxiosError } from 'axios';

// ---------- types (mirror the backend JSON) ----------

export interface User {
  id: string;
  phone: string;
}

export interface Loan {
  id: string;
  friend_name: string;
  amount: number;
  due_date: string; // YYYY-MM-DD
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

// ---------- axios instance ----------

// Android emulator: http://10.0.2.2:4000 | physical phone: http://<laptop LAN IP>:4000
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const api = axios.create({ baseURL: API_URL, timeout: 15000 });

// The token lives in this module variable so the interceptor can read it synchronously.
// AuthContext sets it on login / app start / logout.
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

// AuthContext registers its logout function here (avoids a circular import).
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

api.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // 401 while we HAVE a token means it expired or is invalid -> log out.
    // (A 401 during login, with no token yet, just means "wrong OTP" and is shown inline.)
    if (error.response?.status === 401 && authToken && onUnauthorized) onUnauthorized();
    return Promise.reject(error);
  },
);

// ---------- error helpers ----------

interface ApiErrorBody {
  error?: string;
  details?: { field: string; message: string }[];
}

// Turns any thrown error into one readable sentence for the UI.
export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(err)) {
    if (!err.response) return 'Cannot reach the server. Check your connection and API URL.';
    const body = err.response.data;
    if (body?.details?.length) return body.details.map((d) => d.message).join('\n');
    if (body?.error) return body.error;
  }
  return 'Something went wrong. Please try again.';
}

// Server validation errors keyed by field name, e.g. { amount: "Amount must be ..." }.
export function getFieldErrors(err: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (axios.isAxiosError<ApiErrorBody>(err)) {
    for (const d of err.response?.data?.details ?? []) {
      if (!result[d.field]) result[d.field] = d.message;
    }
  }
  return result;
}

// ---------- API calls ----------

export async function requestOtp(phone: string): Promise<void> {
  await api.post('/auth/request-otp', { phone });
}

export async function verifyOtp(phone: string, otp: string): Promise<{ token: string; user: User }> {
  const res = await api.post<{ token: string; user: User }>('/auth/verify-otp', { phone, otp });
  return res.data;
}

export async function fetchLoans(): Promise<Loan[]> {
  const res = await api.get<Loan[]>('/loans');
  return res.data;
}

export async function fetchSummary(): Promise<Summary> {
  const res = await api.get<Summary>('/loans/summary');
  return res.data;
}

export async function createLoan(form: FormData): Promise<Loan> {
  const res = await api.post<Loan>('/loans', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function repayLoan(id: string): Promise<Loan> {
  const res = await api.patch<Loan>(`/loans/${id}/repay`);
  return res.data;
}

// The server returns receipt paths like "/uploads/abc.png"; images need the full URL.
export function receiptUrl(path: string): string {
  return `${API_URL}${path}`;
}
