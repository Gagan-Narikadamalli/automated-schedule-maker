"use client";

import { useCallback, useRef, useState } from "react";

import { ManagementModal } from "@/components/ManagementModal";

type SchedulerConfirmOptions = {
  title: string;
  message: string;
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type Resolver = (confirmed: boolean) => void;

export function useSchedulerConfirm() {
  const [options, setOptions] = useState<SchedulerConfirmOptions | null>(null);
  const resolverRef = useRef<Resolver | null>(null);

  const ask = useCallback((nextOptions: SchedulerConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      if (resolverRef.current) {
        resolverRef.current(false);
      }

      resolverRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolver?.(confirmed);
  }, []);

  const dialog = (
    <ManagementModal
      open={Boolean(options)}
      eyebrow={options?.eyebrow ?? "SCHEDULE CONFIRMATION"}
      title={options?.title ?? "Confirm schedule change"}
      description="Review the change before it is saved to the schedule."
      size="medium"
      onClose={() => finish(false)}
      footer={
        <>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => finish(false)}
          >
            {options?.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className="button button-warning"
            onClick={() => finish(true)}
          >
            {options?.confirmLabel ?? "Override"}
          </button>
        </>
      }
    >
      <div className="scheduler-confirm-copy">
        {(options?.message ?? "")
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line, index) => (
            <p key={`${index}-${line}`}>{line}</p>
          ))}
      </div>
    </ManagementModal>
  );

  return {
    ask,
    dialog,
  };
}
