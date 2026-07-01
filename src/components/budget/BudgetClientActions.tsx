"use client";

import { useRef, useState } from "react";
import { BudgetPdfContent } from "@/components/budget/BudgetPdfContent";
import { BudgetPdfPreview } from "@/components/budget/BudgetPdfPreview";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/FormFields";
import { CLIENT_BUDGET_SETUP_SQL } from "@/lib/client-budget-db";
import { budgetPdfFilename, saveBudgetPdf } from "@/lib/budget-pdf";
import type { BudgetPlanSnapshot } from "@/lib/budget-utils";
import { createClient } from "@/lib/supabase/client";
import type { Client, ClientPoNumber } from "@/lib/types";
import { formatCurrency, roundMoney } from "@/lib/utils";

interface BudgetClientActionsProps {
  clients: Client[];
  poNumbers: ClientPoNumber[];
  plan: BudgetPlanSnapshot;
}

export function BudgetClientActions({
  clients,
  poNumbers,
  plan,
}: BudgetClientActionsProps) {
  const pdfRef = useRef<HTMLDivElement>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedPoId, setSelectedPoId] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsBudgetSetup, setNeedsBudgetSetup] = useState(false);

  const selectedClient = clients.find((client) => client.id === selectedClientId);
  const clientPos = poNumbers.filter((row) => row.client_id === selectedClientId);
  const selectedPo = clientPos.find((row) => row.id === selectedPoId);
  const budgetAmount = roundMoney(plan.grandTotal);

  function handleClientChange(clientId: string) {
    setSelectedClientId(clientId);
    setSelectedPoId("");
    setError(null);
    setSuccess(null);
  }

  async function handleUpdateClientBudget() {
    setError(null);
    setSuccess(null);
    setNeedsBudgetSetup(false);

    if (!selectedClientId) {
      setError("Select a client first.");
      return;
    }
    if (!selectedPoId) {
      setError("Select a client PO first.");
      return;
    }
    if (plan.rooms.length === 0) {
      setError("Include at least one room and item in the budget before saving.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const { error: clientError } = await supabase
      .from("clients")
      .update({ budget: budgetAmount })
      .eq("id", selectedClientId);

    if (clientError) {
      setSaving(false);
      const message = clientError.message.toLowerCase();
      if (message.includes("budget")) setNeedsBudgetSetup(true);
      setError(clientError.message);
      return;
    }

    const { error: poError } = await supabase
      .from("client_po_numbers")
      .update({ budget: budgetAmount })
      .eq("id", selectedPoId);

    setSaving(false);

    if (poError) {
      const message = poError.message.toLowerCase();
      if (message.includes("budget")) setNeedsBudgetSetup(true);
      setError(poError.message);
      return;
    }

    setSuccess(
      `Saved ${formatCurrency(budgetAmount)} to ${selectedClient?.name ?? "client"} · PO ${selectedPo?.po_number ?? ""}.`
    );
  }

  function handleViewPdf() {
    setError(null);
    setSuccess(null);

    if (!selectedClient) {
      setError("Select a client to view the PDF.");
      return;
    }
    if (plan.rooms.length === 0) {
      setError("Include at least one room and item in the budget before viewing.");
      return;
    }

    setShowPreview(true);
  }

  async function handleSavePdf() {
    setError(null);
    setSuccess(null);

    if (!selectedClient) {
      setError("Select a client to generate the PDF.");
      return;
    }
    if (plan.rooms.length === 0) {
      setError("Include at least one room and item in the budget before exporting.");
      return;
    }
    if (!pdfRef.current) {
      setError("PDF preview is not ready.");
      return;
    }

    setExporting(true);
    try {
      await saveBudgetPdf(
        pdfRef.current,
        budgetPdfFilename(selectedClient.name, selectedPo?.po_number)
      );
      setSuccess("PDF saved.");
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : "Could not save PDF."
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Client budget
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Save the current total investment ({formatCurrency(budgetAmount)}) to a client and PO, or
          export an investment approach PDF.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Client"
            value={selectedClientId}
            onChange={(event) => handleClientChange(event.target.value)}
          >
            <option value="">Select a client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Client PO"
            value={selectedPoId}
            disabled={!selectedClientId || clientPos.length === 0}
            onChange={(event) => {
              setSelectedPoId(event.target.value);
              setError(null);
              setSuccess(null);
            }}
          >
            <option value="">
              {!selectedClientId
                ? "Select a client first"
                : clientPos.length === 0
                  ? "No PO numbers for this client"
                  : "Select a PO"}
            </option>
            {clientPos.map((row) => (
              <option key={row.id} value={row.id}>
                {row.po_number}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" loading={saving} onClick={handleUpdateClientBudget}>
            Update client budget
          </Button>
          <Button type="button" variant="secondary" onClick={handleViewPdf}>
            View PDF
          </Button>
          <Button type="button" variant="secondary" loading={exporting} onClick={handleSavePdf}>
            Save PDF
          </Button>
        </div>

        {needsBudgetSetup && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium">Client budget columns are not set up yet.</p>
            <p className="mt-1">Run this SQL once in Supabase, then try again.</p>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-white p-2 text-xs ring-1 ring-amber-200">
              {CLIENT_BUDGET_SETUP_SQL}
            </pre>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {success && <p className="mt-3 text-sm text-brand-700">{success}</p>}
      </div>

      {showPreview && selectedClient && (
        <BudgetPdfPreview
          clientName={selectedClient.name}
          poNumber={selectedPo?.po_number}
          plan={plan}
          onClose={() => setShowPreview(false)}
        />
      )}

      <div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 -z-50 opacity-0"
        style={{ width: "8.5in" }}
      >
        {selectedClient ? (
          <BudgetPdfContent
            ref={pdfRef}
            clientName={selectedClient.name}
            poNumber={selectedPo?.po_number}
            plan={plan}
          />
        ) : (
          <div ref={pdfRef} />
        )}
      </div>
    </>
  );
}
