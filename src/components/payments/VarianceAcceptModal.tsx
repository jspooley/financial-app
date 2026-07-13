"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextareaField } from "@/components/ui/FormFields";
import { VARIANCE_NOTES_MAX_LENGTH } from "@/lib/ledger-db";
import { formatCurrency } from "@/lib/utils";

interface VarianceAcceptModalProps {
  amount: number;
  clientName: string;
  description: string;
  currentIndex: number;
  totalCount: number;
  initialNotes?: string;
  onAccept: (notes: string) => void;
  onDecline: () => void;
}

export function VarianceAcceptModal({
  amount,
  clientName,
  description,
  currentIndex,
  totalCount,
  initialNotes = "",
  onAccept,
  onDecline,
}: VarianceAcceptModalProps) {
  const isUnderpayment = amount < 0;
  const [notes, setNotes] = useState(initialNotes.slice(0, VARIANCE_NOTES_MAX_LENGTH));
  const [notesError, setNotesError] = useState<string | null>(null);
  const notesLength = notes.length;

  function handleAccept() {
    const trimmed = notes.trim();
    if (!trimmed) {
      setNotesError("An explanation is required to accept a variance.");
      return;
    }
    if (trimmed.length > VARIANCE_NOTES_MAX_LENGTH) {
      setNotesError(`Notes must be ${VARIANCE_NOTES_MAX_LENGTH} characters or less.`);
      return;
    }
    setNotesError(null);
    onAccept(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="variance-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="variance-title" className="text-lg font-semibold text-slate-900">
          {isUnderpayment ? "Accept payment underpayment?" : "Accept payment overpayment?"}
        </h2>
        {totalCount > 1 && (
          <p className="mt-1 text-xs text-slate-500">
            Item {currentIndex + 1} of {totalCount}
          </p>
        )}
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-medium text-slate-800">{clientName}</span>
          {description !== "—" ? (
            <>
              {" "}
              · <span className="text-slate-700">{description}</span>
            </>
          ) : null}
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Variance of{" "}
          <span className="font-semibold text-amber-800">
            {formatCurrency(amount)}
          </span>
          {isUnderpayment
            ? ". If you accept, this line will be marked paid and net profit will be reduced by that amount."
            : ". If you accept, this line will be marked paid. The extra payment_amount remains as revenue."}
        </p>

        <div className="mt-4">
          <TextareaField
            label="Variance notes"
            required
            value={notes}
            maxLength={VARIANCE_NOTES_MAX_LENGTH}
            rows={3}
            placeholder="Explain why this variance is being accepted…"
            hint={`${notesLength}/${VARIANCE_NOTES_MAX_LENGTH} characters`}
            error={notesError ?? undefined}
            onChange={(event) => {
              setNotes(event.target.value.slice(0, VARIANCE_NOTES_MAX_LENGTH));
              if (notesError) setNotesError(null);
            }}
          />
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onDecline}>
            {isUnderpayment ? "No — leave unpaid" : "No — leave unsettled"}
          </Button>
          <Button type="button" onClick={handleAccept}>
            Yes — accept variance
          </Button>
        </div>
      </div>
    </div>
  );
}
