"use client";

import { useEffect, type ReactNode } from "react";

import styles from "./ManagementModal.module.css";

type ManagementModalProps = {
  open: boolean;
  title: string;
  description?: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: "medium" | "large";
};

export function ManagementModal({
  open,
  title,
  description,
  eyebrow,
  children,
  footer,
  onClose,
  size = "large",
}: ManagementModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
    >
      <section
        className={`${styles.modal} ${
          size === "medium" ? styles.medium : styles.large
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className={styles.header}>
          <div className={styles.headingCopy}>
            {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>

          <button
            type="button"
            className={styles.closeButton}
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </section>
    </div>
  );
}
