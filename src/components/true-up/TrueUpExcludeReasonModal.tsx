"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextareaField } from "@/components/ui/FormFields";
import { TRUE_UP_EXCLUDE_REASON_MAX_LENGTH } from "@/lib/ledger-db";

export function TrueUpReasonModal({
  title,
  itemLabel,
  count = 1,
  description,
  confirmLabel,
  requiredError,
  placeholder,
  initialValue = "",
  onConfirm,
  onCancel,
}: {
  title: string;
  itemLabel: string;
  count?: number;
  description: string;
  confirmLabel: string;
  requiredError: string;
  placeholder: string;
  initialValue?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const length = reason.length;

  function handleConfirm() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(requiredError);
      return;
    }
    if (trimmed.length > TRUE_UP_EXCLUDE_REASON_MAX_LENGTH) {
      setError(
        `Description must be ${TRUE_UP_EXCLUDE_REASON_MAX_LENGTH} characters or less.`
      );
      return;
    }
    setError(null);
    onConfirm(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="true-up-reason-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2
          id="true-up-reason-title"
          className="text-lg font-semibold text-slate-900"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {count > 1
            ? `This will apply to ${count} lines, including ${itemLabel}.`
            : itemLabel}
        </p>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        <div className="mt-4">
          <TextareaField
            label="Reason"
            required
            value={reason}
            maxLength={TRUE_UP_EXCLUDE_REASON_MAX_LENGTH}
            rows={3}
            placeholder={placeholder}
            hint={`${length}/${TRUE_UP_EXCLUDE_REASON_MAX_LENGTH} characters`}
            error={error ?? undefined}
            onChange={(event) => {
              setReason(
                event.target.value.slice(0, TRUE_UP_EXCLUDE_REASON_MAX_LENGTH)
              );
              if (error) setError(null);
            }}
          />
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TrueUpExcludeReasonModal({
  itemLabel,
  count = 1,
  onConfirm,
  onCancel,
}: {
  itemLabel: string;
  count?: number;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  return (
    <TrueUpReasonModal
      title="Exclude from true up?"
      itemLabel={itemLabel}
      count={count}
      description="Explain why this should not be split between partners. This description is required."
      confirmLabel="Exclude"
      requiredError="A description is required to exclude from true up."
      placeholder="Why is this excluded from true up?"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
