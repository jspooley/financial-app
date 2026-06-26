"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { TradePartnerForm } from "@/components/forms/TradePartnerForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import type { TradePartner } from "@/lib/types";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";

export default function TradePartnersPage() {
  const [partners, setPartners] = useState<TradePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TradePartner | null>(null);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("trade_partners")
      .select("*")
      .order("company_name", { ascending: true });
    setPartners(data ?? []);
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
      ) : (
        <DataTable
          columns={[
            { key: "company", label: "Company" },
            { key: "discount", label: "Discount (%)" },
            { key: "map", label: "MAP" },
            { key: "expires", label: "MAP Expires" },
            { key: "actions", label: "Actions", className: "text-right" },
          ]}
          rows={partners.map((partner) => ({
            company: partner.company_name,
            discount: formatPercent(Number(partner.discount_amount)),
            map: formatCurrency(Number(partner.minimum_purchase_amount)),
            expires: formatDate(partner.map_expiration),
            actions: (
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(partner);
                    setShowForm(true);
                  }}
                >
                  Edit
                </Button>
                <Button variant="danger" onClick={() => handleDelete(partner)}>
                  Delete
                </Button>
              </div>
            ),
          }))}
          emptyMessage="No trade partners yet."
        />
      )}
    </AppShell>
  );
}
