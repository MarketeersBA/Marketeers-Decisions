import { setMockToken } from "./token";

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = (await res.json()) as { detail?: unknown };
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function signUp(email: string, password: string): Promise<{ ok: boolean }> {
  return post("/api/auth/mock/signup", { email, password });
}

export function confirmSignUp(email: string, code: string): Promise<{ ok: boolean }> {
  return post("/api/auth/mock/confirm", { email, code });
}

export async function signIn(email: string, password: string): Promise<string> {
  const data = await post<{ idToken: string }>("/api/auth/mock/login", { email, password });
  setMockToken(data.idToken);
  return data.idToken;
}
