"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/FormFields";
import { formatCurrency, roundMoney } from "@/lib/utils";

interface ExpenseModalProps {
  outstanding: number;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
}

export function ExpenseModal({ outstanding, onConfirm, onCancel }: ExpenseModalProps) {
  const [customAmount, setCustomAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function validate(amount: number) {
    if (amount <= 0) {
      setError("Enter an amount greater than zero.");
      return false;
    }
    if (amount > outstanding) {
      setError("The expense amount must be less than the outstanding amount.");
      return false;
    }
    setError(null);
    return true;
  }

  function confirmFull() {
    if (!validate(outstanding)) return;
    onConfirm(roundMoney(outstanding));
  }

  function confirmCustom() {
    const amount = roundMoney(Number(customAmount) || 0);
    if (!validate(amount)) return;
    onConfirm(amount);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="expense-title" className="text-lg font-semibold text-slate-900">
          Record expense
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Outstanding balance:{" "}
          <span className="font-medium text-amber-800">{formatCurrency(outstanding)}</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Record the entire amount as expense, or enter a partial expense amount.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <Button type="button" onClick={confirmFull}>
            Expense entire outstanding amount
          </Button>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <label className="block text-sm text-slate-600">
            <span className="mb-1 block">Another amount</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={customAmount}
              onChange={(event) => {
                setCustomAmount(event.target.value);
                setError(null);
              }}
              className={fieldClass}
              placeholder="0.00"
            />
          </label>
          <Button type="button" variant="secondary" className="mt-3 w-full" onClick={confirmCustom}>
            Apply expense amount
          </Button>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
