// عميل REST: يضيف رمز JWT ويحوّل الأخطاء إلى ApiError بكود آلي تترجمه الواجهة
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "labs.token";

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* المتصفح يمنع التخزين */
  }
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: any,
  ) {
    super(code);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(API_URL + "/api" + path, {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized?.();
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "ERROR", data?.error?.details);
  return data as T;
}

/** تنزيل ملف محمي بالمصادقة (PDF/CSV/XLSX) */
export async function download(path: string, fallbackName: string) {
  const token = getToken();
  const res = await fetch(API_URL + "/api" + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, "DOWNLOAD_FAILED");
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const fetcher = <T = any>(path: string) => api<T>(path);
