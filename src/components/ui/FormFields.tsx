import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const editableControlClass =
  "rounded-lg border border-brand-300 bg-white shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 read-only:border-slate-300 read-only:bg-slate-50 read-only:text-slate-500 disabled:border-slate-300 disabled:bg-slate-50 disabled:text-slate-500";

export const fieldClass = `w-full min-h-11 px-3 py-2 text-sm text-slate-900 ${editableControlClass}`;

export const selectChevron =
  "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%3E%3Cpath%20d%3D%22M6%208l4%204%204-4%22%20stroke%3D%22%23ef559e%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')]";

/** Native selects need appearance-none so the pink border renders consistently. */
export const selectFieldClass = `w-full min-h-11 cursor-pointer appearance-none bg-white bg-[length:1.25rem] bg-[right_0.75rem_center] bg-no-repeat px-3 py-2 pr-10 text-sm text-slate-900 ${selectChevron} ${editableControlClass} disabled:cursor-not-allowed`;

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
}

export const InputField = forwardRef<
  HTMLInputElement,
  FieldProps & InputHTMLAttributes<HTMLInputElement>
>(function InputField(
  { label, error, hint, className = "", required, ...props },
  ref
) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <input ref={ref} required={required} className={`${fieldClass} ${className}`} {...props} />
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  FieldProps & SelectHTMLAttributes<HTMLSelectElement>
>(function SelectField(
  {
    label,
    error,
    hint,
    className = "",
    children,
    required,
    ...props
  },
  ref
) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <select
        ref={ref}
        required={required}
        className={`${selectFieldClass} ${className}`}
        {...props}
      >
        {children}
      </select>
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
});

export function TextareaField({
  label,
  error,
  hint,
  className = "",
  required,
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <textarea
        required={required}
        className={`${fieldClass} min-h-24 resize-y ${className}`}
        {...props}
      />
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function CheckboxField({
  label,
  hint,
  error,
  className = "",
  disabled,
  readOnly,
  ...props
}: FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const isDisabled = disabled || readOnly;

  return (
    <label
      className={`block space-y-1.5 ${isDisabled ? "cursor-default" : "cursor-pointer"}`}
    >
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span
        className={`flex min-h-11 w-full items-center rounded-lg border px-3 shadow-sm ${
          isDisabled
            ? "border-slate-300 bg-slate-50"
            : "border-brand-300 bg-white"
        } ${className}`}
      >
        <input
          type="checkbox"
          className="size-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:border-slate-300"
          disabled={isDisabled}
          readOnly={readOnly}
          {...props}
        />
      </span>
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}
