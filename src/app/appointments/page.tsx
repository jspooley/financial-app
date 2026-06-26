"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AppointmentForm } from "@/components/forms/AppointmentForm";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import type { Appointment } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type AppointmentFilter = "all" | "pending" | "won" | "lost";

function appointmentStatus(appointment: Appointment) {
  if (appointment.job_won) return "Won";
  if (appointment.job_lost) return "Lost";
  return "Pending";
}

function AppointmentsPageContent() {
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("status");
  const filter: AppointmentFilter =
    filterParam === "pending" || filterParam === "won" || filterParam === "lost"
      ? filterParam
      : "all";

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(searchParams.get("add") === "1");
  const [editing, setEditing] = useState<Appointment | null>(null);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .order("appointment_date", { ascending: false });

    if (error) {
      setLoadError(error.message);
      setAppointments([]);
    } else {
      setAppointments(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setShowForm(true);
      setEditing(null);
    }
  }, [searchParams]);

  const visibleAppointments = useMemo(() => {
    if (filter === "pending") {
      return appointments.filter((row) => !row.job_won && !row.job_lost);
    }
    if (filter === "won") {
      return appointments.filter((row) => row.job_won);
    }
    if (filter === "lost") {
      return appointments.filter((row) => row.job_lost);
    }
    return appointments;
  }, [appointments, filter]);

  async function handleDelete(appointment: Appointment) {
    if (!confirm(`Delete appointment for "${appointment.client_name}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("appointments").delete().eq("id", appointment.id);
    if (error) {
      alert(error.message);
      return;
    }
    loadAppointments();
  }

  const filterLabel =
    filter === "pending"
      ? "Pending appointments"
      : filter === "won"
        ? "Won appointments"
        : filter === "lost"
          ? "Lost appointments"
          : null;

  return (
    <AppShell>
      <PageHeader
        title="Appointments"
        description="Track client appointments and whether each job was won or lost."
        action={
          !showForm && (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              Add Appointment
            </Button>
          )
        }
      />

      {loadError && !showForm && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Could not load appointments: {loadError}
          {loadError.includes("appointments") && (
            <p className="mt-2">
              Run <code className="rounded bg-red-100 px-1">supabase/migrations/012_appointments.sql</code>{" "}
              in the Supabase SQL Editor.
            </p>
          )}
        </div>
      )}

      {filterLabel && !showForm && (
        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-slate-800">
          Showing {filterLabel} ({visibleAppointments.length}).{" "}
          <Link href="/appointments" className="font-medium text-brand-700 hover:underline">
            Show all
          </Link>
        </div>
      )}

      {showForm ? (
        <AppointmentForm
          initial={editing}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setShowForm(false);
            setEditing(null);
            loadAppointments();
          }}
        />
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading appointments...</p>
      ) : visibleAppointments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-900">No appointments yet</p>
          <p className="mt-1 text-sm text-slate-600">
            {filterLabel ? `No ${filterLabel.toLowerCase()}.` : "Add your first appointment to get started."}
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            Add Appointment
          </Button>
        </div>
      ) : (
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "client", label: "Client" },
            { key: "contact", label: "Contact" },
            { key: "referral", label: "Referral" },
            { key: "status", label: "Status" },
            { key: "notes", label: "Notes" },
            { key: "actions", label: "Actions", className: "text-right" },
          ]}
          rows={visibleAppointments.map((appointment) => ({
            date: formatDate(appointment.appointment_date),
            client: appointment.client_name,
            contact: (
              <div className="text-sm">
                <div>{appointment.client_email ?? "—"}</div>
                <div className="text-slate-500">{appointment.client_phone ?? "—"}</div>
              </div>
            ),
            referral: (
              <div className="text-sm">
                <div>{appointment.referred_by ?? "—"}</div>
                <div className="text-slate-500">{appointment.referral_source ?? "—"}</div>
              </div>
            ),
            status: appointmentStatus(appointment),
            notes: appointment.notes ?? "—",
            actions: (
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(appointment);
                    setShowForm(true);
                  }}
                >
                  Edit
                </Button>
                <Button variant="danger" onClick={() => handleDelete(appointment)}>
                  Delete
                </Button>
              </div>
            ),
          }))}
        />
      )}
    </AppShell>
  );
}

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-slate-500">Loading...</p>}>
      <AppointmentsPageContent />
    </Suspense>
  );
}
