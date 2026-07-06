"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TradePartnerForm } from "@/components/forms/TradePartnerForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { RowActions } from "@/components/ui/RowActions";
import { createClient } from "@/lib/supabase/client";
import type { TradePartner } from "@/lib/types";
import {
  calculateTradeDiscountPercentFromPricing,
  defaultLedgerDiscountPercent,
  formatCurrency,
  formatDate,
  formatPercent,
  roundMoney,
} from "@/lib/utils";

function tradePartnerDiscountPercent(partner: TradePartner): number {
  const retail = Number(partner.retail_price ?? 0);
  const designer = Number(partner.designer_cost ?? 0);
  if (retail > 0) {
    return calculateTradeDiscountPercentFromPricing(retail, designer);
  }
  return Number(partner.discount_amount ?? 0);
}

function TradePartnerSummary({ partners }: { partners: TradePartner[] }) {
  const { averageDiscount, grossProfitGoal } = useMemo(() => {
    if (partners.length === 0) {
      return { averageDiscount: 0, grossProfitGoal: 0 };
    }

    const discounts = partners.map(tradePartnerDiscountPercent);
    const averageDiscount = roundMoney(
      discounts.reduce((sum, discount) => sum + discount, 0) / discounts.length
    );

    return {
      averageDiscount,
      grossProfitGoal: defaultLedgerDiscountPercent(averageDiscount),
    };
  }, [partners]);

  return (
    <section className="mb-6 grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Average Trade Discount
        </p>
        <p className="mt-1 text-2xl font-bold text-brand-800">
          {partners.length === 0 ? "—" : formatPercent(averageDiscount)}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Mean discount across {partners.length}{" "}
          {partners.length === 1 ? "partner" : "partners"}
        </p>
      </div>
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-600">
          Gross Profit Goal
        </p>
        <p className="mt-1 text-2xl font-bold text-brand-800">
          {partners.length === 0 ? "—" : formatPercent(grossProfitGoal)}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Half of the average trade discount
        </p>
      </div>
    </section>
  );
}

export default function TradePartnersPage() {
  const [partners, setPartners] = useState<TradePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TradePartner | null>(null);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("trade_partners")
      .select("*")
      .order("company_name", { ascending: true });
    if (error) {
      setLoadError(error.message);
      setPartners([]);
    } else {
      setPartners(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  async function handleDelete(partner: TradePartner) {
    if (!confirm(`Delete trade partner "${partner.company_name}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("trade_partners")
      .delete()
      .eq("id", partner.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadPartners();
  }

  return (
    <AppShell>
      <PageHeader
        title="Trade Partners"
        description="Industry partners, discounts, and MAP agreements."
        action={
          !showForm && (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              Add Trade Partner
            </Button>
          )
        }
      />

      {showForm ? (
        <TradePartnerForm
          initial={editing}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
            loadPartners();
          }}
        />
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading trade partners...</p>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Could not load trade partners.</p>
          <p className="mt-1">{loadError}</p>
          <Button variant="secondary" className="mt-3" onClick={() => loadPartners()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <TradePartnerSummary partners={partners} />
          <DataTable
          stickyFirstColumn
          mobileTitleKey="company"
          columns={[
            { key: "actions", label: "Actions" },
            { key: "company", label: "Company" },
            { key: "retailPrice", label: "Retail Price" },
            { key: "designerCost", label: "Designer Cost" },
            { key: "discount", label: "Discount (%)" },
            { key: "map", label: "MAP" },
            { key: "expires", label: "MAP Expires" },
          ]}
          rows={partners.map((partner) => {
            const retail = Number(partner.retail_price ?? 0);
            const designer = Number(partner.designer_cost ?? 0);
            const discount = tradePartnerDiscountPercent(partner);

            return {
            actions: (
              <RowActions
                onEdit={() => {
                  setEditing(partner);
                  setShowForm(true);
                }}
                onDelete={() => handleDelete(partner)}
              />
            ),
            company: partner.company_name,
            retailPrice: retail > 0 ? formatCurrency(retail) : "—",
            designerCost: designer > 0 ? formatCurrency(designer) : "—",
            discount: formatPercent(discount),
            map: formatCurrency(Number(partner.minimum_purchase_amount)),
            expires: formatDate(partner.map_expiration),
          };
          })}
          emptyMessage="No trade partners yet."
        />
        </>
      )}
    </AppShell>
  );
}
