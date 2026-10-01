"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type LoginStep = "CREDENTIALS" | "OTP";

type LoginResponse = {
  error?: string;
  success?: boolean;
  temporaryMode?: boolean;
  requiresOtp?: boolean;
  challengeId?: string;
  email?: string;
};

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>("CREDENTIALS");
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
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
          usernameOrEmail,
          password,
        }),
      });

      const data = (await response.json()) as LoginResponse;

      if (!response.ok || !data.success) {
        setMessage(data.error ?? "Sign-in could not be started.");
        return;
      }

      if (data.temporaryMode) {
        router.push("/");
        router.refresh();
        return;
      }

      if (data.requiresOtp && data.challengeId) {
        setChallengeId(data.challengeId);
        setMaskedEmail(data.email ?? "your email");
        setStep("OTP");
        setMessage("Verification code sent.");
        return;
      }

      setMessage("The sign-in response was incomplete. Please try again.");
    } catch {
      setMessage("Unable to contact the sign-in service.");
    } finally {
      setLoading(false);
    }
  }

  async function submitVerificationCode() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          challengeId,
          code: verificationCode,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        success?: boolean;
      };

      if (!response.ok || !data.success) {
        setMessage(data.error ?? "Verification failed.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setMessage("Unable to verify the code.");
    } finally {
      setLoading(false);
    }
  }

  function restartLogin() {
    setStep("CREDENTIALS");
    setChallengeId("");
    setVerificationCode("");
    setPassword("");
    setMessage("");
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">
        <span className="auth-brand-title">SUCCESS ON THE SPECTRUM</span>
        <span className="auth-brand-subtitle">Automated Schedule Maker</span>
      </div>

      {step === "CREDENTIALS" ? (
        <>
          <div className="auth-heading">
            <h1>Schedule Maker Access</h1>
            <p>
              Enter your username or email and password. The temporary testing
              account signs in directly; normal clinic accounts continue to
              email verification.
            </p>
          </div>

          <div className="auth-form">
            <label className="form-field">
              <span>Username or email</span>
              <input
                autoComplete="username"
                value={usernameOrEmail}
                onChange={(event) => setUsernameOrEmail(event.target.value)}
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
              {loading ? "Checking..." : "Sign In"}
            </button>
          </div>

          <div className="auth-message">
            Test access is controlled only through Vercel environment variables.
            Remove the temporary login variables when production testing is
            finished to require normal account + OTP access.
          </div>
        </>
      ) : (
        <>
          <div className="auth-heading">
            <h1>Verify your email</h1>
            <p>
              Enter the 6-digit code sent to <strong>{maskedEmail}</strong>. The
              code expires after 10 minutes.
            </p>
          </div>

          <div className="auth-form">
            <label className="form-field">
              <span>Verification code</span>
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={verificationCode}
                onChange={(event) =>
                  setVerificationCode(
                    event.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    verificationCode.length === 6 &&
                    !loading
                  ) {
                    void submitVerificationCode();
                  }
                }}
              />
            </label>

            <button
              type="button"
              className="button button-primary auth-submit-button"
              onClick={() => void submitVerificationCode()}
              disabled={loading || verificationCode.length !== 6}
            >
              {loading ? "Verifying..." : "Verify and Sign In"}
            </button>

            <button
              type="button"
              className="button button-secondary auth-submit-button"
              onClick={restartLogin}
              disabled={loading}
            >
              Start Over
            </button>
          </div>
        </>
      )}

      {message && <div className="auth-message">{message}</div>}
    </div>
  );
}
