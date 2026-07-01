import { Button } from "./Button";

interface RowActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
  editLabel?: string;
  deleteLabel?: string;
}

export function RowActions({
  onEdit,
  onDelete,
  deleteDisabled,
  editLabel = "Edit",
  deleteLabel = "Delete",
}: RowActionsProps) {
  return (
    <div className="flex w-21 flex-col gap-1.5">
      <Button
        variant="secondary"
        className="w-full min-h-[33px] px-3 py-1.5"
        onClick={onEdit}
      >
        {editLabel}
      </Button>
      <Button
        variant="danger"
        className="w-full min-h-[33px] px-3 py-1.5"
        onClick={onDelete}
        disabled={deleteDisabled}
      >
        {deleteLabel}
      </Button>
    </div>
  );
}
