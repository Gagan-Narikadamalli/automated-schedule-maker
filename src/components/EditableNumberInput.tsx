"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
} from "react";

type EditableNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue"
> & {
  value: number | string;
};

/**
 * Numeric input that lets users temporarily clear the field while editing.
 *
 * Controlled number inputs often turn an empty string into 0 immediately,
 * which produces values such as "040" when the user tries to replace 0 with
 * 40. This component keeps the typed text locally while focused, only sends
 * non-empty values to the existing change handler, and restores the last valid
 * value if the field is left empty.
 */
export function EditableNumberInput({
  value,
  onChange,
  onFocus,
  onBlur,
  ...props
}: EditableNumberInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(String(value ?? ""));
    }
  }, [editing, value]);

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    setEditing(true);
    setDraft(String(value ?? ""));
    onFocus?.(event);

    // A normal first focus selects the current value so typing replaces it.
    // The user can then click/double-click again to position the caret and make
    // a smaller edit without fighting a forced zero.
    requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setDraft(nextValue);

    // Keep the field visually empty while the user is replacing a value.
    // Existing forms continue receiving ordinary input events as soon as a
    // valid replacement value is present.
    if (nextValue !== "") {
      onChange?.(event);
    }
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    setEditing(false);

    if (draft === "") {
      setDraft(String(value ?? ""));
    }

    onBlur?.(event);
  }

  return (
    <input
      {...props}
      ref={inputRef}
      type="number"
      value={editing ? draft : String(value ?? "")}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
