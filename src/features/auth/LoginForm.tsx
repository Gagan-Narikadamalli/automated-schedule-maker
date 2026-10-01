"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitCredentials() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          usernameOrEmail: username,
          password,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        success?: boolean;
      };

      if (!response.ok || !data.success) {
        setMessage(data.error ?? "Sign-in could not be completed.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setMessage("Unable to contact the sign-in service.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <span className="auth-brand-title">SUCCESS ON THE SPECTRUM</span>
        <span className="auth-brand-subtitle">Automated Schedule Maker</span>
      </div>

      <div className="auth-heading">
        <h1>Schedule Maker Access</h1>
        <p>
          Temporary testing login is enabled while the full account and email
          verification workflow is being completed.
        </p>
      </div>

      <div className="auth-form">
        <label className="form-field">
          <span>Username</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !loading) {
                void submitCredentials();
              }
            }}
          />
        </label>

        <label className="form-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !loading) {
                void submitCredentials();
              }
            }}
          />
        </label>

        <button
          type="button"
          className="button button-primary auth-submit-button"
          onClick={() => void submitCredentials()}
          disabled={loading}
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </div>

      <div className="auth-message">
        Temporary access mode is active. OTP verification is disabled for now.
      </div>

      {message && <div className="auth-message">{message}</div>}
    </div>
  );
}
