"use client";

import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const shellStyle = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background: "linear-gradient(145deg, #f4f9fc, #e8f2f7)",
  fontFamily: "Arial, Helvetica, sans-serif",
} as const;

const cardStyle = {
  width: "min(620px, 100%)",
  padding: "34px",
  border: "1px solid #d9e7ef",
  borderRadius: "20px",
  background: "#ffffff",
  boxShadow: "0 20px 55px rgba(27, 73, 101, 0.14)",
  textAlign: "center",
} as const;

const buttonRowStyle = {
  display: "flex",
  justifyContent: "center",
  flexWrap: "wrap",
  gap: "10px",
  marginTop: "22px",
} as const;

const primaryButtonStyle = {
  border: 0,
  borderRadius: "10px",
  padding: "11px 18px",
  background: "#0b79c5",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 800,
  cursor: "pointer",
} as const;

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  border: "1px solid #bfd4e1",
  background: "#ffffff",
  color: "#174963",
} as const;

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("Schedule Maker page error:", error);
  }, [error]);

  return (
    <main style={shellStyle}>
      <section style={cardStyle} role="alert">
        <div style={{ fontSize: "38px", marginBottom: "8px" }}>🛠️</div>
        <div
          style={{
            display: "inline-block",
            padding: "5px 10px",
            borderRadius: "999px",
            background: "#eef6fa",
            color: "#23617f",
            fontSize: "11px",
            fontWeight: 900,
            letterSpacing: "0.08em",
          }}
        >
          TEMPORARILY UNAVAILABLE
        </div>
        <h1 style={{ margin: "14px 0 8px", color: "#163f56", fontSize: "28px" }}>
          We&apos;ll be back soon
        </h1>
        <p style={{ margin: 0, color: "#5d7380", lineHeight: 1.6 }}>
          The Schedule Maker hit an unexpected problem. Try again first. If the
          problem continues, the affected part of the website may be under
          maintenance for a short time.
        </p>
        <div style={buttonRowStyle}>
          <button type="button" onClick={reset} style={primaryButtonStyle}>
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={secondaryButtonStyle}
          >
            Reload website
          </button>
        </div>
      </section>
    </main>
  );
}
