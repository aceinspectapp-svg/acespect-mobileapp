import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AcespectLogo } from "../../components/AcespectLogo";
import { api, homeFor, type AuthUser } from "../api";
import { useAppData } from "../data";
import { EnrolStep, MfaStep } from "../components/SignInSteps";

const MIN = 12;
const input: React.CSSProperties = { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 14, color: "#1a2a4a", boxSizing: "border-box", background: "#f9fafb", marginTop: 6 };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginTop: 14 };
const button: React.CSSProperties = { width: "100%", marginTop: 18, padding: 13, borderRadius: 10, border: "none", background: "linear-gradient(135deg, #0f1d35, #1a2a4a)", color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer" };

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f5f6fa", display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "Inter, -apple-system, sans-serif" }}>
      <div style={{ background: "linear-gradient(135deg, #0f1d35 0%, #1a2a4a 65%, #1e3565 100%)", width: "100%", padding: "36px 24px 56px", textAlign: "center" }}>
        <AcespectLogo size="md" />
      </div>
      <main style={{ background: "white", borderRadius: 16, border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(0,0,0,0.10)", padding: "32px 30px", width: "100%", maxWidth: 440, boxSizing: "border-box", marginTop: -30 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1a2a4a", margin: "0 0 6px" }}>{title}</h1>
        {children}
      </main>
    </div>
  );
}

/** A live checklist so the rule is never a surprise: at least 12 characters, the two boxes match. */
function PasswordHints({ password, confirm }: { password: string; confirm: string }) {
  const rule = (ok: boolean, text: string) => <li style={{ color: ok ? "#15803d" : "#64748b" }}>{ok ? "✓" : "•"} {text}</li>;
  return <ul style={{ fontSize: 12, margin: "10px 0 0", paddingLeft: 16, listStyle: "none", lineHeight: 1.6 }}>
    {rule(password.length >= MIN, `At least ${MIN} characters`)}
    {rule(password.length > 0 && password === confirm, "Both entries match")}
  </ul>;
}

export function AcceptInvitation() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { completeSignIn } = useAppData();
  const [info, setInfo] = useState<{ email: string; name: string | null; termsVersion: string; privacyVersion: string } | null>(null);
  const [problem, setProblem] = useState<{ code?: string; message: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<{ kind: "mfa" | "enroll"; token: string } | null>(null);

  useEffect(() => {
    api.auth.invitation(token).then(setInfo).catch((e) => setProblem({ code: (e as { code?: string }).code, message: (e as Error).message }));
  }, [token]);

  const done = async (u: AuthUser) => { await completeSignIn(u); navigate(homeFor(u)); };
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const o = await api.auth.accept(token, password, accept);
      if (o.kind === "ok") await done(o.user);
      else setStep({ kind: o.kind === "mfa" ? "mfa" : "enroll", token: o.mfaToken });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (problem) {
    return (
      <Frame title={problem.code === "INVITATION_USED" ? "This link has already been used" : problem.code === "INVITATION_EXPIRED" ? "This link has expired" : "This link is not valid"}>
        <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>{problem.message}</p>
        <p style={{ fontSize: 13 }}><Link to="/" style={{ color: "#2563eb" }}>Go to sign in</Link></p>
      </Frame>
    );
  }
  if (!info) return <Frame title="Activate your account"><p style={{ fontSize: 13, color: "#94a3b8" }}>Checking your link…</p></Frame>;
  if (step) {
    return (
      <Frame title="Almost there">
        {step.kind === "mfa" ? <MfaStep token={step.token} onDone={done} onBack={() => setStep(null)} /> : <EnrolStep token={step.token} onDone={done} />}
      </Frame>
    );
  }
  return (
    <Frame title="Activate your account">
      <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>{info.name ? `${info.name}, ` : ""}choose a password for <b>{info.email}</b>.</p>
      <label htmlFor="pw" style={label}>Password</label>
      <input id="pw" type="password" autoComplete="new-password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} />
      <label htmlFor="pw2" style={label}>Confirm password</label>
      <input id="pw2" type="password" autoComplete="new-password" style={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <PasswordHints password={password} confirm={confirm} />
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#374151", marginTop: 16, lineHeight: 1.5 }}>
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I have read the privacy collection notice (version {info.privacyVersion}) and accept the terms of use (version {info.termsVersion}).</span>
      </label>
      {error && <p role="alert" style={{ fontSize: 12, color: "#dc2626", marginTop: 10 }}>{error}</p>}
      <button style={{ ...button, opacity: busy ? 0.6 : 1 }} disabled={busy || password.length < MIN || password !== confirm || !accept} onClick={submit}>{busy ? "Activating…" : "Activate account"}</button>
    </Frame>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  return (
    <Frame title="Reset your password">
      {sent ? (
        <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>If an account exists for <b>{email}</b>, we have emailed a link to choose a new password. It works once and expires in an hour.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>Enter your email and we will send you a link.</p>
          <label htmlFor="em" style={label}>Email address</label>
          <input id="em" type="email" style={input} value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p role="alert" style={{ fontSize: 12, color: "#dc2626" }}>{error}</p>}
          <button style={button} disabled={!email.includes("@")} onClick={() => api.auth.forgot(email.trim()).then(() => setSent(true)).catch((e) => setError((e as Error).message))}>Send reset link</button>
        </>
      )}
      <p style={{ textAlign: "center", fontSize: 12, marginTop: 16 }}><Link to="/" style={{ color: "#2563eb" }}>Back to sign in</Link></p>
    </Frame>
  );
}

export function ResetPassword() {
  const { token = "" } = useParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  return (
    <Frame title="Choose a new password">
      {ok ? (
        <>
          <p style={{ fontSize: 13, color: "#374151" }}>Your password has been changed and your other sessions were signed out.</p>
          <Link to="/" style={{ color: "#2563eb", fontSize: 13 }}>Sign in</Link>
        </>
      ) : (
        <>
          <label htmlFor="pw" style={label}>New password</label>
          <input id="pw" type="password" autoComplete="new-password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} />
          <label htmlFor="pw2" style={label}>Confirm password</label>
          <input id="pw2" type="password" autoComplete="new-password" style={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <PasswordHints password={password} confirm={confirm} />
          {error && <p role="alert" style={{ fontSize: 12, color: "#dc2626" }}>{error}</p>}
          <button style={button} disabled={password.length < MIN || password !== confirm} onClick={() => api.auth.reset(token, password).then(() => setOk(true)).catch((e) => setError((e as Error).message))}>Change password</button>
        </>
      )}
    </Frame>
  );
}
