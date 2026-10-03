import { useState } from "react";
import { useNavigate } from "react-router";
import { Mail, Lock, Eye, EyeOff, LogIn } from "lucide-react";
import { AcespectLogo } from "../../components/AcespectLogo";
import { useAppData } from "../data";
import { api, homeFor, type AuthUser } from "../api";
import { EnrolStep, ForgotLink, MfaStep, SsoButtons } from "../components/SignInSteps";

export function RoleSelect() {
  const navigate = useNavigate();
  const { completeSignIn } = useAppData();
  const [step, setStep] = useState<{ kind: "creds" } | { kind: "mfa"; token: string } | { kind: "enroll"; token: string }>({ kind: "creds" });
  const reason = new URLSearchParams(window.location.search).get("reason");

  const finish = async (user: AuthUser) => {
    await completeSignIn(user);
    navigate(homeFor(user));
  };
  const handleOutcome = async (o: Awaited<ReturnType<typeof api.loginStep>>) => {
    if (o.kind === "ok") return finish(o.user);
    setStep(o.kind === "mfa" ? { kind: "mfa", token: o.mfaToken } : { kind: "enroll", token: o.mfaToken });
    setLoading(false);
  };
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass]  = useState(false);
  const [error, setError]        = useState("");
  const [loading, setLoading]    = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await handleOutcome(await api.loginStep(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f6fa",
      display: "flex",
      flexDirection: "column",
      fontFamily: "Inter, -apple-system, sans-serif",
    }}>
      {/* Hero header */}
      <div style={{
        background: "linear-gradient(135deg, #0f1d35 0%, #1a2a4a 65%, #1e3565 100%)",
        padding: "48px 24px 64px",
        textAlign: "center",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
          <AcespectLogo size="md" />
        </div>
        <h1 style={{ fontSize: "28px", fontWeight: 800, color: "white", margin: "0 0 8px", letterSpacing: "-0.5px" }}>
          Inspection Review Portal
        </h1>
        <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.5)", margin: 0 }}>
          Sign in to continue
        </p>
      </div>

      {/* Login card */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "0 24px 60px",
        marginTop: "-36px",
        gap: "24px",
        flexWrap: "wrap",
      }}>
        <div style={{
          background: "white",
          borderRadius: "16px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 8px 32px rgba(0,0,0,0.10)",
          padding: "36px 32px",
          width: "100%",
          maxWidth: "400px",
          boxSizing: "border-box",
        }}>
          {step.kind === "mfa" && <MfaStep token={step.token} onDone={finish} onBack={() => setStep({ kind: "creds" })} />}
          {step.kind === "enroll" && <EnrolStep token={step.token} onDone={finish} />}
          {step.kind === "creds" && (<>
          {reason === "SESSION_IDLE" && <p role="status" style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", margin: "0 0 14px" }}>You were signed out after a period of inactivity.</p>}
          {(reason === "SESSION_REVOKED" || reason === "ACCOUNT_INACTIVE") && <p role="status" style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", margin: "0 0 14px" }}>Your session was ended. Sign in again.</p>}
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#1a2a4a", margin: "0 0 24px" }}>
            Sign In
          </h2>

          {/* Email */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
              Email Address
            </label>
            <div style={{ position: "relative" }}>
              <Mail size={15} color="#9ca3af" style={{ position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                onKeyDown={handleKeyDown}
                placeholder="Enter your email"
                style={{
                  width: "100%", padding: "11px 12px 11px 40px",
                  borderRadius: "10px", border: "1.5px solid #e5e7eb",
                  fontSize: "14px", color: "#1a2a4a", outline: "none",
                  boxSizing: "border-box", transition: "border-color 0.12s",
                  background: "#f9fafb",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = "#2563eb")}
                onBlur={e => (e.currentTarget.style.borderColor = "#e5e7eb")}
              />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: "8px" }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <Lock size={15} color="#9ca3af" style={{ position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onKeyDown={handleKeyDown}
                placeholder="Enter your password"
                style={{
                  width: "100%", padding: "11px 40px 11px 40px",
                  borderRadius: "10px", border: "1.5px solid #e5e7eb",
                  fontSize: "14px", color: "#1a2a4a", outline: "none",
                  boxSizing: "border-box", transition: "border-color 0.12s",
                  background: "#f9fafb",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = "#2563eb")}
                onBlur={e => (e.currentTarget.style.borderColor = "#e5e7eb")}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                style={{ position: "absolute", right: "13px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0 }}
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p style={{ fontSize: "12px", color: "#dc2626", margin: "8px 0 0", padding: "8px 12px", background: "#fff5f5", borderRadius: "8px", border: "1px solid #fecaca" }}>
              {error}
            </p>
          )}

          {/* Login button */}
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              width: "100%", marginTop: "20px",
              padding: "13px", borderRadius: "10px", border: "none",
              background: loading ? "#94a3b8" : "linear-gradient(135deg, #0f1d35, #1a2a4a)",
              color: "white", fontSize: "15px", fontWeight: 700,
              cursor: loading ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              transition: "opacity 0.15s",
              boxShadow: "0 4px 12px rgba(26,42,74,0.3)",
            }}
          >
            <LogIn size={16} />
            {loading ? "Signing in…" : "Sign In"}
          </button>
          <ForgotLink />
          <SsoButtons onOutcome={handleOutcome} onError={setError} />
          </>)}
        </div>

        {/* Demo credentials panel */}
        <div style={{
          background: "white",
          borderRadius: "16px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 8px 32px rgba(0,0,0,0.10)",
          padding: "28px 28px",
          width: "100%",
          maxWidth: "360px",
          boxSizing: "border-box",
        }}>
          <p style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 16px" }}>
            Demo Credentials
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              { role: "Admin",     color: "#7c3aed", bg: "#faf5ff", email: "admin@acespect.app",    pass: "Admin123",   initials: "AU" },
              { role: "Reviewer",  color: "#2563eb", bg: "#eff6ff", email: "reviewer@acespect.app", pass: "Review123",  initials: "SC" },
              { role: "Inspector", color: "#16a34a", bg: "#f0fdf4", email: "jane@acespect.app",     pass: "Inspect123", initials: "JT" },
            ].map(({ role, color, bg, email: em, pass, initials }) => (
              <button
                key={em}
                onClick={() => { setEmail(em); setPassword(pass); setError(""); }}
                style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "10px 14px", borderRadius: "10px",
                  background: "#f9fafb", border: "1px solid #e5e7eb",
                  cursor: "pointer", textAlign: "left", width: "100%",
                  transition: "all 0.12s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = color; (e.currentTarget as HTMLButtonElement).style.background = bg; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#e5e7eb"; (e.currentTarget as HTMLButtonElement).style.background = "#f9fafb"; }}
              >
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: bg, color, fontSize: "11px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1.5px solid ${color}40` }}>
                  {initials}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "12px", fontWeight: 600, color: "#1a2a4a", margin: 0 }}>
                    {em.split("@")[0].charAt(0).toUpperCase() + em.split("@")[0].slice(1).replace(".", " ")}
                    <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "8px", background: bg, color }}>{role}</span>
                  </p>
                  <p style={{ fontSize: "11px", color: "#94a3b8", margin: "1px 0 0" }}>{em}</p>
                </div>
              </button>
            ))}
          </div>
          <p style={{ fontSize: "11px", color: "#d1d5db", margin: "14px 0 0", textAlign: "center" }}>
            Click any row to auto-fill credentials
          </p>
        </div>
      </div>

      <footer style={{ textAlign: "center", padding: "16px", borderTop: "1px solid #e5e7eb", background: "white", marginTop: "auto" }}>
        <p style={{ fontSize: "11px", color: "#d1d5db", margin: 0 }}>© 2024 Acespect Pty Ltd</p>
      </footer>
    </div>
  );
}
