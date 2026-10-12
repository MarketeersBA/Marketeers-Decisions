import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";

import { setAuthToken } from "./token";

let pool: CognitoUserPool | null = null;

export function initCognito(userPoolId: string, clientId: string) {
  pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
}

function requirePool() {
  if (!pool) throw new Error("Sign-in is not configured");
  return pool;
}

function userFor(email: string) {
  return new CognitoUser({ Username: email.trim(), Pool: requirePool() });
}

function messageOf(err: unknown) {
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return "Something went wrong";
}

export function signUp(email: string, password: string): Promise<void> {
  const attributes = [new CognitoUserAttribute({ Name: "email", Value: email.trim() })];
  return new Promise((resolve, reject) => {
    requirePool().signUp(email.trim(), password, attributes, [], (err) => {
      if (err) reject(new Error(messageOf(err)));
      else resolve();
    });
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    userFor(email).confirmRegistration(code.trim(), true, (err) => {
      if (err) reject(new Error(messageOf(err)));
      else resolve();
    });
  });
}

export function signIn(email: string, password: string): Promise<string> {
  const details = new AuthenticationDetails({ Username: email.trim(), Password: password });
  return new Promise((resolve, reject) => {
    userFor(email).authenticateUser(details, {
      onSuccess: (session) => {
        const token = session.getIdToken().getJwtToken();
        setAuthToken(token);
        resolve(token);
      },
      onFailure: (err) => reject(new Error(messageOf(err))),
    });
  });
}

export function restoreSession(): Promise<string | null> {
  const current = pool?.getCurrentUser();
  if (!current) {
    setAuthToken(null);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    current.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        setAuthToken(null);
        resolve(null);
        return;
      }
      const token = session.getIdToken().getJwtToken();
      setAuthToken(token);
      resolve(token);
    });
  });
}

export function signOut() {
  pool?.getCurrentUser()?.signOut();
  setAuthToken(null);
}
