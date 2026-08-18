"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { InputField, SelectField } from "@/components/ui/FormFields";

const schema = z.object({
  from_room: z.string().min(1, "Select a room to rename"),
  to_room: z
    .string()
    .trim()
    .min(1, "Enter a new room name")
    .max(80, "Room name must be 80 characters or less"),
});

type FormValues = z.infer<typeof schema>;

interface RenameRoomFormProps {
  rooms: string[];
  itemCounts: Record<string, number>;
  initialRoom?: string;
  onSuccess: (fromRoom: string, toRoom: string) => void;
  onCancel: () => void;
}

export function RenameRoomForm({
  rooms,
  itemCounts,
  initialRoom = "",
  onSuccess,
  onCancel,
}: RenameRoomFormProps) {
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      from_room: rooms.includes(initialRoom) ? initialRoom : rooms[0] ?? "",
      to_room: rooms.includes(initialRoom) ? initialRoom : rooms[0] ?? "",
    },
  });

  const fromRoom = watch("from_room");
  const toRoom = watch("to_room");
  const itemCount = itemCounts[fromRoom] ?? 0;
  const trimmedTo = toRoom.trim();
  const merging =
    trimmedTo.length > 0 &&
    trimmedTo !== fromRoom &&
    rooms.includes(trimmedTo);

  const roomOptions = useMemo(
    () => rooms.map((room) => ({ value: room, label: room })),
    [rooms]
  );

  async function onSubmit(values: FormValues) {
    setError(null);
    const from = values.from_room;
    const to = values.to_room.trim();
    if (from === to) {
      onCancel();
      return;
    }

    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("budget_items")
      .update({ room: to })
      .eq("room", from);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onSuccess(from, to);
  }

  if (rooms.length === 0) {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Rename Room</h2>
        <p className="text-sm text-slate-600">There are no rooms to rename yet.</p>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Rename Room</h2>
        <p className="mt-1 text-sm text-slate-600">
          Updates every item currently in this room. If the new name already
          exists, those items are combined into that room.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Current room"
          error={errors.from_room?.message}
          {...register("from_room")}
        >
          {roomOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>

        <InputField
          label="New room name"
          maxLength={80}
          error={errors.to_room?.message}
          {...register("to_room")}
        />
      </div>

      <p className="text-sm text-slate-600">
        {itemCount === 1 ? "1 item" : `${itemCount} items`} will be updated
        {merging ? ` and combined with existing items in “${trimmedTo}”` : ""}.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isSubmitting} disabled={itemCount === 0}>
          Save Room Name
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
