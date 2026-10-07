"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Schedule Maker global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            boxSizing: "border-box",
            background: "linear-gradient(145deg, #f4f9fc, #e8f2f7)",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          <section
            role="alert"
            style={{
              width: "min(620px, 100%)",
              boxSizing: "border-box",
              padding: "34px",
              border: "1px solid #d9e7ef",
              borderRadius: "20px",
              background: "#ffffff",
              boxShadow: "0 20px 55px rgba(27, 73, 101, 0.14)",
              textAlign: "center",
            }}
          >
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
              SERVICE TEMPORARILY UNAVAILABLE
            </div>
            <h1
              style={{
                margin: "14px 0 8px",
                color: "#163f56",
                fontSize: "28px",
              }}
            >
              We&apos;ll be back soon
            </h1>
            <p style={{ margin: 0, color: "#5d7380", lineHeight: 1.6 }}>
              The Schedule Maker is having a temporary problem. Please try
              again. If it continues, the website may be under maintenance for
              a short time.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                flexWrap: "wrap",
                gap: "10px",
                marginTop: "22px",
              }}
            >
              <button
                type="button"
                onClick={reset}
                style={{
                  border: 0,
                  borderRadius: "10px",
                  padding: "11px 18px",
                  background: "#0b79c5",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  border: "1px solid #bfd4e1",
                  borderRadius: "10px",
                  padding: "11px 18px",
                  background: "#ffffff",
                  color: "#174963",
                  fontSize: "14px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Reload website
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
