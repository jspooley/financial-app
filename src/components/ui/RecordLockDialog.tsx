"use client";

import { Button } from "@/components/ui/Button";

interface RecordLockDialogProps {
  holderName: string;
  error?: string;
  onDismiss: () => void;
}

export function RecordLockDialog({
  holderName,
  error,
  onDismiss,
}: RecordLockDialogProps) {
  const message = error
    ? error
    : `This item is being edited by ${holderName}.`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="record-lock-title"
      aria-describedby="record-lock-message"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="px-4 py-4 sm:px-6">
          <h2 id="record-lock-title" className="text-lg font-semibold text-slate-900">
            Record in use
          </h2>
          <p id="record-lock-message" className="mt-2 text-sm text-slate-600">
            {message}
          </p>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-4 py-4 sm:px-6">
          <Button type="button" onClick={onDismiss}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
