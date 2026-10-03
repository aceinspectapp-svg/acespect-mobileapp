import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type AuthUser } from "../api";

const input: React.CSSProperties = { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, color: "#1a2a4a", boxSizing: "border-box", background: "#f9fafb" };
const primary: React.CSSProperties = { width: "100%", marginTop: 16, padding: 13, borderRadius: 10, border: "none", background: "linear-gradient(135deg, #0f1d35, #1a2a4a)", color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer" };
const errBox: React.CSSProperties = { fontSize: 12, color: "#dc2626", margin: "8px 0 0", padding: "8px 12px", background: "#fff5f5", borderRadius: 8, border: "1px solid #fecaca" };

/** Second sign-in step: the six-digit authenticator code, or one of the one-time backup codes. */
export function MfaStep({ token, onDone, onBack }: { token: string; onDone: (u: AuthUser) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const o = await api.auth.verifyMfa(token, code.trim());
      if (o.kind === "ok") onDone(o.user);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a2a4a", margin: "0 0 8px" }}>Two-step verification</h2>
      <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
      <label htmlFor="mfa-code" style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Code</label>
      <input id="mfa-code" autoFocus inputMode="numeric" autoComplete="one-time-code" style={{ ...input, marginTop: 6, letterSpacing: 4, fontSize: 18 }} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      {error && <p role="alert" style={errBox}>{error}</p>}
      <button style={{ ...primary, opacity: busy ? 0.6 : 1 }} disabled={busy || code.trim().length < 6} onClick={submit}>{busy ? "Checking…" : "Verify"}</button>
      <button style={{ ...primary, background: "transparent", color: "#64748b", boxShadow: "none", marginTop: 8, fontWeight: 500, fontSize: 13 }} onClick={onBack}>Back to sign in</button>
    </div>
  );
}

/** First sign-in for a role that must use MFA: scan the secret, confirm a code, save the backup codes. */
export function EnrolStep({ token, onDone }: { token: string; onDone: (u: AuthUser) => void }) {
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ user: AuthUser; backupCodes: string[] } | null>(null);
  useEffect(() => { api.auth.startEnrol(token).then(setSecret).catch((e) => setError((e as Error).message)); }, [token]);
  useEffect(() => {
    if (!secret) return;
    // A QR image is only a convenience; the secret is shown as text too. The image comes from the user's own browser library, not a third party.
    import("../qr").then((m) => m.qrDataUrl(secret.otpauthUri)).then(setQr).catch(() => setQr(null));
  }, [secret]);
  const confirm = async () => {
    setBusy(true); setError("");
    try {
      const r = await api.auth.completeEnrol(token, code.trim());
      if (r.outcome.kind === "ok") setDone({ user: r.outcome.user, backupCodes: r.backupCodes });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a2a4a", margin: "0 0 8px" }}>Save your backup codes</h2>
        <p style={{ fontSize: 13, color: "#64748b" }}>Each code works once if you lose your phone. They are shown only now.</p>
        <pre style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, fontSize: 14, lineHeight: 1.8 }}>{done.backupCodes.join("\n")}</pre>
        <button style={primary} onClick={() => onDone(done.user)}>I have saved them</button>
      </div>
    );
  }
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a2a4a", margin: "0 0 8px" }}>Set up two-step verification</h2>
      <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 12px" }}>Your role requires it. Add this account to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), then enter the code it shows.</p>
      {qr && <img src={qr} alt="QR code to scan with your authenticator app" width={176} height={176} style={{ display: "block", margin: "0 auto 8px" }} />}
      {secret && <p style={{ fontSize: 12, color: "#475569", wordBreak: "break-all", textAlign: "center" }}>Or enter this key: <code>{secret.secret}</code></p>}
      <input aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" style={{ ...input, letterSpacing: 4, fontSize: 18 }} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirm()} />
      {error && <p role="alert" style={errBox}>{error}</p>}
      <button style={{ ...primary, opacity: busy ? 0.6 : 1 }} disabled={busy || !secret || code.trim().length < 6} onClick={confirm}>{busy ? "Checking…" : "Confirm and sign in"}</button>
    </div>
  );
}

const GOOGLE = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const MICROSOFT = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;

function randomNonce() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Open the provider's sign-in in a popup; the callback page posts the ID token back (implicit OpenID flow). */
function ssoPopup(provider: "google" | "microsoft"): Promise<string> {
  const nonce = randomNonce();
  const redirect = `${window.location.origin}/sso-callback`;
  const url = provider === "google"
    ? `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(GOOGLE!)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=id_token&scope=${encodeURIComponent("openid email profile")}&nonce=${nonce}&prompt=select_account`
    : `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(MICROSOFT!)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=id_token&scope=${encodeURIComponent("openid email profile")}&response_mode=fragment&nonce=${nonce}&prompt=select_account`;
  return new Promise((resolve, reject) => {
    const win = window.open(url, "acespect-sso", "width=480,height=640");
    if (!win) return reject(new Error("Allow pop-ups to sign in with a work account."));
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || ev.data?.type !== "acespect-sso") return;
      window.removeEventListener("message", onMsg);
      clearInterval(timer);
      if (ev.data.idToken) resolve(ev.data.idToken as string);
      else reject(new Error(ev.data.error ?? "Sign-in was cancelled."));
    };
    window.addEventListener("message", onMsg);
    const timer = setInterval(() => { if (win.closed) { clearInterval(timer); window.removeEventListener("message", onMsg); reject(new Error("Sign-in was cancelled.")); } }, 500);
  });
}

/** Single sign-on buttons. Only providers configured for this deployment are shown; unknown accounts are refused by the server. */
export function SsoButtons({ onOutcome, onError }: { onOutcome: (o: Awaited<ReturnType<typeof api.auth.sso>>) => void; onError: (m: string) => void }) {
  const [msEnabled, setMsEnabled] = useState(false);
  useEffect(() => { api.auth.ssoConfig().then((c) => setMsEnabled(c.microsoft)).catch(() => undefined); }, []);
  const show = (!!GOOGLE) || (msEnabled && !!MICROSOFT);
  if (!show) return null;
  const go = async (p: "google" | "microsoft") => {
    try { onOutcome(await api.auth.sso(p, await ssoPopup(p))); } catch (e) { onError((e as Error).message); }
  };
  const btn: React.CSSProperties = { width: "100%", padding: 11, borderRadius: 10, border: "1.5px solid #e5e7eb", background: "white", color: "#1a2a4a", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8 };
  return (
    <div style={{ marginTop: 18, borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
      <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 4px", textAlign: "center" }}>or sign in with your organisation account</p>
      {GOOGLE && <button style={btn} onClick={() => go("google")}>Continue with Google</button>}
      {msEnabled && MICROSOFT && <button style={btn} onClick={() => go("microsoft")}>Continue with Microsoft</button>}
    </div>
  );
}

export function ForgotLink() {
  return <p style={{ textAlign: "center", margin: "14px 0 0", fontSize: 12 }}><Link to="/forgot" style={{ color: "#2563eb" }}>Forgot your password?</Link></p>;
}

/** The popup target: reads the ID token from the URL fragment and hands it to the opener. */
export function SsoCallback() {
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    window.opener?.postMessage({ type: "acespect-sso", idToken: p.get("id_token"), error: p.get("error_description") ?? p.get("error") }, window.location.origin);
    window.close();
  }, []);
  return <p style={{ padding: 24, fontFamily: "Inter, sans-serif", color: "#64748b" }}>Finishing sign-in…</p>;
}
