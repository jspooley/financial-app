"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextareaField } from "@/components/ui/FormFields";
import { TRUE_UP_EXCLUDE_REASON_MAX_LENGTH } from "@/lib/ledger-db";

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
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const length = reason.length;

  function handleConfirm() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A description is required to exclude from true up.");
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
      aria-labelledby="true-up-exclude-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2
          id="true-up-exclude-title"
          className="text-lg font-semibold text-slate-900"
        >
          Exclude from true up?
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {count > 1
            ? `This will exclude ${count} lines, including ${itemLabel}.`
            : itemLabel}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Explain why this should not be split between partners. This
          description is required.
        </p>
        <div className="mt-4">
          <TextareaField
            label="Reason"
            required
            value={reason}
            maxLength={TRUE_UP_EXCLUDE_REASON_MAX_LENGTH}
            rows={3}
            placeholder="Why is this excluded from true up?"
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
            Exclude
          </Button>
        </div>
      </div>
    </div>
  );
}
