"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ManagementModal } from "@/components/ManagementModal";

import styles from "./ActionConfirmDialog.module.css";

export type ActionDialogChoice = {
  id: string;
  label: string;
  tone?: "primary" | "danger";
};

export type ActionDialogRequest = {
  title: string;
  description: string;
  eyebrow?: string;
  detail?: ReactNode;
  actions: ActionDialogChoice[];
  cancelLabel?: string;
};

export function useActionConfirmDialog() {
  const [request, setRequest] = useState<ActionDialogRequest | null>(
    null
  );
  const resolverRef = useRef<((choice: string | null) => void) | null>(
    null
  );

  function finish(choice: string | null) {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolver?.(choice);
  }

  function requestActionDialog(
    nextRequest: ActionDialogRequest
  ): Promise<string | null> {
    resolverRef.current?.(null);

    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setRequest(nextRequest);
    });
  }

  useEffect(() => {
    return () => {
      resolverRef.current?.(null);
      resolverRef.current = null;
    };
  }, []);

  const actionDialog = (
    <ManagementModal
      open={Boolean(request)}
      size="medium"
      eyebrow={request?.eyebrow ?? "CONFIRM ACTION"}
      title={request?.title ?? "Confirm action"}
      description={request?.description}
      onClose={() => finish(null)}
      footer={
        request ? (
          <>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => finish(null)}
            >
              {request.cancelLabel ?? "Cancel"}
            </button>
            {request.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={
                  action.tone === "danger"
                    ? styles.dangerAction
                    : "button button-primary"
                }
                onClick={() => finish(action.id)}
              >
                {action.label}
              </button>
            ))}
          </>
        ) : null
      }
    >
      <div className={styles.confirmCard}>
        <div className={styles.icon} aria-hidden="true">
          !
        </div>
        <div className={styles.copy}>
          <strong>This action needs confirmation.</strong>
          <p>
            Review the details above before continuing. Nothing changes
            until you choose an action below.
          </p>
          {request?.detail ? (
            <div className={styles.detail}>{request.detail}</div>
          ) : null}
        </div>
      </div>
    </ManagementModal>
  );

  return {
    requestActionDialog,
    actionDialog,
  };
}
