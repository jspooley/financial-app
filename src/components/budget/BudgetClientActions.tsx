"use client";

import { useRef, useState } from "react";
import { BudgetPdfContent } from "@/components/budget/BudgetPdfContent";
import { BudgetPdfPreview } from "@/components/budget/BudgetPdfPreview";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/FormFields";
import {
  mergeLoadedBudgetPlan,
  parseClientBudgetPlanSaved,
  type BudgetPlannerState,
} from "@/lib/budget-planner-state";
import {
  downloadSavedClientBudgetPdf,
  saveClientBudgetPlan,
} from "@/lib/client-budget-plan-db";
import { CLIENT_BUDGET_SETUP_SQL } from "@/lib/client-budget-db";
import { budgetPdfFilename, saveBudgetPdf } from "@/lib/budget-pdf";
import type { BudgetPlanSnapshot } from "@/lib/budget-utils";
import { createClient } from "@/lib/supabase/client";
import type { BudgetItem, Client, ClientPoNumber } from "@/lib/types";
import { formatCurrency, formatDate, roundMoney } from "@/lib/utils";

interface BudgetClientActionsProps {
  clients: Client[];
  poNumbers: ClientPoNumber[];
  items: BudgetItem[];
  rooms: string[];
  plan: BudgetPlanSnapshot;
  plannerState: BudgetPlannerState;
  onClientsUpdated: () => void;
  onLoadPlan: (state: BudgetPlannerState) => void;
}

export function BudgetClientActions({
  clients,
  poNumbers,
  items,
  rooms,
  plan,
  plannerState,
  onClientsUpdated,
  onLoadPlan,
}: BudgetClientActionsProps) {
  const pdfRef = useRef<HTMLDivElement>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedPoId, setSelectedPoId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsBudgetSetup, setNeedsBudgetSetup] = useState(false);

  const selectedClient = clients.find((client) => client.id === selectedClientId);
  const clientPos = poNumbers.filter((row) => row.client_id === selectedClientId);
  const selectedPo = clientPos.find((row) => row.id === selectedPoId);
  const budgetAmount = roundMoney(plan.grandTotal);
  const savedPlan = selectedPo ? parseClientBudgetPlanSaved(selectedPo.budget_plan) : null;

  function handleClientChange(clientId: string) {
    setSelectedClientId(clientId);
    setSelectedPoId("");
    setError(null);
    setSuccess(null);
  }

  function isBudgetSchemaError(message: string) {
    const lower = message.toLowerCase();
    return (
      lower.includes("budget_plan") ||
      lower.includes("budget_pdf_path") ||
      lower.includes("budget")
    );
  }

  async function handleSaveClientBudget() {
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
    if (!pdfRef.current) {
      setError("PDF preview is not ready.");
      return;
    }

    setSaving(true);
    try {
      const result = await saveClientBudgetPlan({
        clientId: selectedClientId,
        poId: selectedPoId,
        plannerState,
        grandTotal: budgetAmount,
        pdfElement: pdfRef.current,
      });
      onClientsUpdated();
      setSuccess(
        result.pdfWarning ??
          `Saved budget (${formatCurrency(budgetAmount)}) for ${selectedClient?.name ?? "client"} · PO ${selectedPo?.po_number ?? ""}.`
      );
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Could not save client budget.";
      if (isBudgetSchemaError(message)) setNeedsBudgetSetup(true);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadClientBudget() {
    setError(null);
    setSuccess(null);
    setNeedsBudgetSetup(false);

    if (!selectedPoId) {
      setError("Select a client PO first.");
      return;
    }

    setLoadingPlan(true);
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("client_po_numbers")
      .select("budget_plan")
      .eq("id", selectedPoId)
      .single();

    setLoadingPlan(false);

    if (fetchError) {
      if (isBudgetSchemaError(fetchError.message)) setNeedsBudgetSetup(true);
      setError(fetchError.message);
      return;
    }

    const parsed = parseClientBudgetPlanSaved(data?.budget_plan);
    if (!parsed) {
      setError("No saved budget found for this PO.");
      return;
    }

    onLoadPlan(mergeLoadedBudgetPlan(parsed, items, rooms));
    setSuccess(
      `Loaded budget saved ${formatDate(parsed.savedAt)} for PO ${selectedPo?.po_number ?? ""}.`
    );
  }

  async function handleDownloadSavedPdf() {
    setError(null);
    setSuccess(null);

    if (!selectedPo?.budget_pdf_path) {
      setError("No saved PDF for this PO yet.");
      return;
    }

    setDownloadingPdf(true);
    try {
      await downloadSavedClientBudgetPdf(selectedPo.budget_pdf_path);
      setSuccess("Saved PDF downloaded.");
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Could not download saved PDF."
      );
    } finally {
      setDownloadingPdf(false);
    }
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
      setSuccess("PDF saved to your downloads folder.");
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
          Save the current investment approach ({formatCurrency(budgetAmount)}) to a client and PO,
          then load it later with the same sliders and amounts.
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
                {parseClientBudgetPlanSaved(row.budget_plan) ? " · saved" : ""}
              </option>
            ))}
          </SelectField>
        </div>

        {savedPlan && (
          <p className="mt-3 text-sm text-slate-600">
            Last saved for this PO: {formatCurrency(savedPlan.grandTotal)} on{" "}
            {formatDate(savedPlan.savedAt)}.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" loading={saving} onClick={handleSaveClientBudget}>
            Save Client Budget
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={loadingPlan}
            disabled={!selectedPoId}
            onClick={handleLoadClientBudget}
          >
            Load Client Budget
          </Button>
          <Button type="button" variant="secondary" onClick={handleViewPdf}>
            View PDF
          </Button>
          <Button type="button" variant="secondary" loading={exporting} onClick={handleSavePdf}>
            Save PDF
          </Button>
          {selectedPo?.budget_pdf_path ? (
            <Button
              type="button"
              variant="secondary"
              loading={downloadingPdf}
              onClick={handleDownloadSavedPdf}
            >
              Download Saved PDF
            </Button>
          ) : null}
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
