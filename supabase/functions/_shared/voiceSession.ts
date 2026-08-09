/**
 * Short-lived, HMAC-signed session tokens that let the Vapi voice assistant's
 * tool webhook run as a specific, already-authenticated operator.
 *
 * The browser never mints these: `nl-voice-session` verifies the caller's JWT,
 * resolves their company, and signs the token server-side. The tool webhook
 * (which Vapi calls, so it has no user JWT) verifies the signature and gets
 * back the exact same { userId, companyId } scope the text assistant uses.
 */

const enc = new TextEncoder();

interface SessionClaims {
  sid: string;
  uid: string;
  cid: string;
  exp: number;
}

async function key(): Promise<CryptoKey> {
  const secret = Deno.env.get("NL_VOICE_SESSION_SECRET");
  if (!secret) throw new Error("NL_VOICE_SESSION_SECRET is not configured");
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string) =>
  Uint8Array.from(
    atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );

export async function signSession(
  userId: string,
  companyId: string,
  ttlSeconds = 60 * 60,
): Promise<{ token: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const claims: SessionClaims = {
    sid: sessionId,
    uid: userId,
    cid: companyId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await key(), enc.encode(payload));
  return { token: `${payload}.${b64url(new Uint8Array(sig))}`, sessionId };
}

export async function verifySession(token: string | null): Promise<SessionClaims | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(),
      fromB64url(sig),
      enc.encode(payload),
    );
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as SessionClaims;
    if (!claims?.uid || !claims?.cid || !claims?.sid) return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
