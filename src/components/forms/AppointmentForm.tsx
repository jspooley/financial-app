"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { REFERRAL_SOURCE_OPTIONS, type Appointment, type ReferralSource } from "@/lib/types";
import { todayDateInputValue, toDateInputValue } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { CheckboxField, InputField, SelectField, TextareaField } from "@/components/ui/FormFields";

const referralSourceSchema = z.enum([
  "Instagram",
  "Facebook",
  "Word of Mouth",
  "Web Search",
  "Other",
]);

const schema = z
  .object({
    appointment_date: z.string().min(1, "Appointment date is required"),
    client_name: z.string().min(1, "Client name is required"),
    client_email: z.string().email("Invalid email").optional().or(z.literal("")),
    client_phone: z.string().optional(),
    client_address: z.string().optional(),
    referred_by: z.string().optional(),
    referral_source: z.union([referralSourceSchema, z.literal("")]).optional(),
    notes: z.string().max(500, "Notes must be 500 characters or less").optional(),
    job_won: z.boolean(),
    job_lost: z.boolean(),
    proposal_sent: z.boolean(),
  })
  .refine((values) => !(values.job_won && values.job_lost), {
    message: "An appointment cannot be marked both won and lost",
    path: ["job_lost"],
  });

type FormValues = z.infer<typeof schema>;

interface AppointmentFormProps {
  initial?: Appointment | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function AppointmentForm({ initial, onSuccess, onCancel }: AppointmentFormProps) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      appointment_date:
        toDateInputValue(initial?.appointment_date) || todayDateInputValue(),
      client_name: initial?.client_name ?? "",
      client_email: initial?.client_email ?? "",
      client_phone: initial?.client_phone ?? "",
      client_address: initial?.client_address ?? "",
      referred_by: initial?.referred_by ?? "",
      referral_source: initial?.referral_source ?? "",
      notes: initial?.notes ?? "",
      job_won: initial?.job_won ?? false,
      job_lost: initial?.job_lost ?? false,
      proposal_sent: initial?.proposal_sent ?? false,
    },
  });

  const jobWon = watch("job_won");
  const jobLost = watch("job_lost");
  const proposalSent = watch("proposal_sent");
  const notesLength = watch("notes")?.length ?? 0;

  async function onSubmit(values: FormValues) {
    setError(null);
    const supabase = createClient();
    let clientId = initial?.client_id ?? null;

    if (values.job_won && !clientId) {
      const { data: newClient, error: clientError } = await supabase
        .from("clients")
        .insert({
          name: values.client_name,
          phone: values.client_phone || null,
          email: values.client_email || null,
          address: values.client_address || null,
        })
        .select("id")
        .single();

      if (clientError) {
        setError(clientError.message);
        return;
      }

      clientId = newClient.id;
    }

    const payload = {
      appointment_date: values.appointment_date,
      client_name: values.client_name,
      client_email: values.client_email || null,
      client_phone: values.client_phone || null,
      client_address: values.client_address || null,
      referred_by: values.referred_by?.trim() ? values.referred_by.trim() : null,
      referral_source: values.referral_source
        ? (values.referral_source as ReferralSource)
        : null,
      notes: values.notes?.trim() ? values.notes.trim() : null,
      job_won: values.job_won,
      job_lost: values.job_lost,
      proposal_sent: values.proposal_sent,
      client_id: clientId,
    };

    const { error: dbError } = initial
      ? await supabase.from("appointments").update(payload).eq("id", initial.id)
      : await supabase.from("appointments").insert(payload);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onSuccess();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        {initial ? "Edit Appointment" : "New Appointment"}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Appointment Date"
          type="date"
          error={errors.appointment_date?.message}
          {...register("appointment_date")}
        />
        <InputField
          label="Client Name"
          error={errors.client_name?.message}
          {...register("client_name")}
        />
        <InputField
          label="Client Email"
          type="email"
          error={errors.client_email?.message}
          {...register("client_email")}
        />
        <InputField label="Client Phone Number" {...register("client_phone")} />
        <InputField
          label="Client Address"
          className="sm:col-span-2"
          {...register("client_address")}
        />
        <InputField label="Referred By" {...register("referred_by")} />
        <SelectField
          label="Referral Source"
          error={errors.referral_source?.message}
          {...register("referral_source")}
        >
          <option value="">Select source…</option>
          {REFERRAL_SOURCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectField>
        <TextareaField
          label="Notes"
          className="sm:col-span-2"
          maxLength={500}
          hint={`${notesLength}/500 characters`}
          error={errors.notes?.message}
          {...register("notes")}
        />
        <CheckboxField
          label="Job Won"
          checked={jobWon}
          onChange={(event) => {
            const checked = event.target.checked;
            setValue("job_won", checked, { shouldValidate: true });
            if (checked) setValue("job_lost", false, { shouldValidate: true });
          }}
        />
        <CheckboxField
          label="Job Lost"
          checked={jobLost}
          error={errors.job_lost?.message}
          onChange={(event) => {
            const checked = event.target.checked;
            setValue("job_lost", checked, { shouldValidate: true });
            if (checked) setValue("job_won", false, { shouldValidate: true });
          }}
        />
        <CheckboxField
          label="Proposal Sent"
          checked={proposalSent}
          onChange={(event) => setValue("proposal_sent", event.target.checked)}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isSubmitting}>
          {initial ? "Save Changes" : "Create Appointment"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
