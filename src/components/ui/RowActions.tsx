import { Button } from "./Button";

interface RowActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  deleteDisabled?: boolean;
  editLabel?: string;
  deleteLabel?: string;
  duplicateLabel?: string;
}

export function RowActions({
  onEdit,
  onDelete,
  onDuplicate,
  deleteDisabled,
  editLabel = "Edit",
  deleteLabel = "Delete",
  duplicateLabel = "Duplicate",
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
      {onDuplicate && (
        <Button
          variant="secondary"
          className="w-full min-h-[33px] px-3 py-1.5"
          onClick={onDuplicate}
        >
          {duplicateLabel}
        </Button>
      )}
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
