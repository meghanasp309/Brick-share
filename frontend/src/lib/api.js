// Talks to the backend (API server). Every call returns the JSON body,
// or throws an Error with the server's message (e.g. "Wrong email or password").
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const TOKEN_KEY = "brickshare-token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private window: the login just won't be remembered.
  }
}

/**
 * api("/market")                                   GET
 * api("/auth/login", { body: { email, password } }) POST with JSON
 * api("/kyc", { body: formData })                    POST a form with a file
 */
export async function api(path, { method, body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(API_URL + path, {
      method: method || (body ? "POST" : "GET"),
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Is the backend running (npm start in backend)?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Downloads a file that needs the login token (e.g. a KYC ID) and opens it in a new tab. */
export async function openProtectedFile(path) {
  const res = await fetch(API_URL + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("Could not open the file");
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
