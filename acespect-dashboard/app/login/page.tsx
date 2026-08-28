"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setTokens, setRole, homeForRole } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{
        accessToken: string;
        refreshToken: string;
        user: { role: string };
      }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      // Inspectors sign in here too — they land on their own drafts rather
      // than the reviewer queue.
      const role = res.user.role;
      if (role !== "REVIEWER" && role !== "ADMIN" && role !== "INSPECTOR") {
        throw new Error("This account cannot access the dashboard.");
      }
      setTokens(res.accessToken, res.refreshToken);
      setRole(role);
      router.push(homeForRole(role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 4 }}>
          ACE <span>SPECT</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Inspector &amp; reviewer sign in
        </p>
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        <div className="spacer" />
        <label>Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
        />
        <div className="spacer" />
        <button className="primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
