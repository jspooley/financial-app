"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { BUDGET_ROOM_OPTIONS, type BudgetItem } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import {
  CheckboxField,
  InputField,
  SelectField,
} from "@/components/ui/FormFields";

const ADD_ROOM_VALUE = "__add_room__";

const schema = z
  .object({
    room_choice: z.string().min(1, "Room is required"),
    custom_room: z.string().optional(),
    item_description: z
      .string()
      .min(1, "Description is required")
      .max(30, "Description must be 30 characters or less"),
    include_in_budget: z.boolean(),
    quantity: z.coerce
      .number()
      .int("Quantity must be a whole number")
      .min(0, "Quantity must be 0 or greater"),
    low_amount: z.coerce.number().min(0, "Low must be 0 or greater"),
    medium_amount: z.coerce.number().min(0, "Medium must be 0 or greater"),
    high_amount: z.coerce.number().min(0, "High must be 0 or greater"),
  })
  .superRefine((values, ctx) => {
    if (values.room_choice === ADD_ROOM_VALUE && !values.custom_room?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a room name",
        path: ["custom_room"],
      });
    }
  });

type FormValues = z.infer<typeof schema>;

export type BudgetItemFormDefaults = Pick<
  BudgetItem,
  | "room"
  | "item_description"
  | "include_in_budget"
  | "quantity"
  | "low_amount"
  | "medium_amount"
  | "high_amount"
>;

interface BudgetItemFormProps {
  /** When set, form updates this row. Cleared after Duplicate. */
  initial?: BudgetItem | null;
  /** Prefill for create / duplicate (ignored when `initial` is set until Duplicate). */
  defaults?: BudgetItemFormDefaults | null;
  customRooms?: string[];
  onSuccess: () => void;
  onCancel: () => void;
}

function roomChoiceFromRoom(room: string) {
  if ((BUDGET_ROOM_OPTIONS as readonly string[]).includes(room)) {
    return room;
  }
  return ADD_ROOM_VALUE;
}

function valuesFromSource(source: BudgetItemFormDefaults | BudgetItem | null | undefined) {
  if (!source) {
    return {
      room_choice: "",
      custom_room: "",
      item_description: "",
      include_in_budget: false,
      quantity: 0,
      low_amount: 0,
      medium_amount: 0,
      high_amount: 0,
    };
  }

  const roomChoice = roomChoiceFromRoom(source.room);
  return {
    room_choice: roomChoice,
    custom_room: roomChoice === ADD_ROOM_VALUE ? source.room : "",
    item_description: source.item_description,
    include_in_budget: source.include_in_budget,
    quantity: source.quantity,
    low_amount: source.low_amount,
    medium_amount: source.medium_amount,
    high_amount: source.high_amount,
  };
}

export function BudgetItemForm({
  initial,
  defaults = null,
  customRooms = [],
  onSuccess,
  onCancel,
}: BudgetItemFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isDuplicateCreate, setIsDuplicateCreate] = useState(false);
  const isEdit = Boolean(initial) && !isDuplicateCreate;
  const prefillSource = initial ?? defaults;

  const roomOptions = useMemo(() => {
    const extras = customRooms.filter(
      (room) => !(BUDGET_ROOM_OPTIONS as readonly string[]).includes(room)
    );
    const uniqueExtras = [...new Set(extras)].sort((a, b) => a.localeCompare(b));
    return [
      ...BUDGET_ROOM_OPTIONS.map((room) => ({ value: room, label: room })),
      ...uniqueExtras.map((room) => ({ value: room, label: room })),
      { value: ADD_ROOM_VALUE, label: "Add another room…" },
    ];
  }, [customRooms]);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valuesFromSource(prefillSource),
  });

  const roomChoice = watch("room_choice");

  function handleDuplicate() {
    setError(null);
    setIsDuplicateCreate(true);
    reset(getValues());
  }

  async function onSubmit(values: FormValues) {
    setError(null);
    const room =
      values.room_choice === ADD_ROOM_VALUE
        ? values.custom_room!.trim()
        : values.room_choice;

    const supabase = createClient();
    const payload = {
      room,
      item_description: values.item_description.trim(),
      include_in_budget: values.include_in_budget,
      quantity: values.quantity,
      low_amount: values.low_amount,
      medium_amount: values.medium_amount,
      high_amount: values.high_amount,
    };

    const { error: dbError } = isEdit
      ? await supabase.from("budget_items").update(payload).eq("id", initial!.id)
      : await supabase.from("budget_items").insert(payload);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onSuccess();
  }

  const title = isEdit
    ? "Edit Budget Item"
    : isDuplicateCreate || defaults
      ? "Duplicate Budget Item"
      : "New Budget Item";

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {(isDuplicateCreate || (!isEdit && defaults)) && (
          <p className="mt-1 text-sm text-slate-600">
            Low, medium, and high amounts are carried over. Change the room or
            other fields, then create the new item.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Room"
          error={errors.room_choice?.message}
          {...register("room_choice")}
        >
          <option value="">Select a room</option>
          {roomOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>

        {roomChoice === ADD_ROOM_VALUE && (
          <InputField
            label="New room name"
            error={errors.custom_room?.message}
            {...register("custom_room")}
          />
        )}

        <InputField
          label="Item description"
          maxLength={30}
          className={roomChoice === ADD_ROOM_VALUE ? "" : "sm:col-span-2"}
          error={errors.item_description?.message}
          {...register("item_description")}
        />

        <CheckboxField
          label="Include in budget"
          labelPosition="inline"
          className="sm:col-span-2"
          {...register("include_in_budget")}
        />

        <InputField
          label="Quantity"
          type="number"
          step="1"
          min="0"
          error={errors.quantity?.message}
          {...register("quantity")}
        />

        <InputField
          label="Low (save)"
          type="number"
          step="0.01"
          min="0"
          error={errors.low_amount?.message}
          {...register("low_amount")}
        />
        <InputField
          label="Medium"
          type="number"
          step="0.01"
          min="0"
          error={errors.medium_amount?.message}
          {...register("medium_amount")}
        />
        <InputField
          label="High (splurge)"
          type="number"
          step="0.01"
          min="0"
          error={errors.high_amount?.message}
          {...register("high_amount")}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? "Save Changes" : "Create Item"}
        </Button>
        {initial && !isDuplicateCreate && (
          <Button type="button" variant="secondary" onClick={handleDuplicate}>
            Duplicate
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
