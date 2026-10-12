const MOCK_TOKEN_KEY = "ms_mock_id_token";

let idToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  idToken = token;
}

export function setMockToken(token: string | null) {
  idToken = token;
  try {
    if (token) sessionStorage.setItem(MOCK_TOKEN_KEY, token);
    else sessionStorage.removeItem(MOCK_TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export function restoreMockToken(): string | null {
  try {
    idToken = sessionStorage.getItem(MOCK_TOKEN_KEY);
  } catch {
    idToken = null;
  }
  return idToken;
}

export function getAuthToken() {
  return idToken;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export function notifyUnauthorized() {
  if (onUnauthorized) {
    onUnauthorized();
    return;
  }
  setMockToken(null);
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}
