"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SetupForm() {
  const router = useRouter();
  const [setupKey, setSetupKey] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitSetup() {
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          setupKey,
          username,
          email,
          password,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: string;
        success?: boolean;
      };

      if (!response.ok || !data.success) {
        setMessage(data.error ?? "Setup could not be completed.");
        return;
      }

      setMessage(data.message ?? "Setup complete.");
      window.setTimeout(() => {
        router.push("/login");
      }, 700);
    } catch {
      setMessage("Unable to contact the setup service.");
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
        <h1>Initial administrator setup</h1>
        <p>
          This page only creates the first account. After an administrator exists,
          the server blocks additional setup attempts.
        </p>
      </div>

      <div className="auth-form">
        <label className="form-field">
          <span>Setup key</span>
          <input
            type="password"
            value={setupKey}
            onChange={(event) => setSetupKey(event.target.value)}
          />
        </label>

        <label className="form-field">
          <span>Admin username</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="form-field">
          <span>Admin email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="form-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="form-field">
          <span>Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>

        <p className="helper-text">
          Use at least 12 characters. The password is stored as a salted scrypt hash,
          never as plain text.
        </p>

        <button
          type="button"
          className="button button-primary auth-submit-button"
          onClick={() => void submitSetup()}
          disabled={loading}
        >
          {loading ? "Creating account..." : "Create Administrator"}
        </button>
      </div>

      {message && <div className="auth-message">{message}</div>}
    </div>
  );
}
