import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const fieldClass =
  "w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
}

export const InputField = forwardRef<
  HTMLInputElement,
  FieldProps & InputHTMLAttributes<HTMLInputElement>
>(function InputField(
  { label, error, hint, className = "", ...props },
  ref
) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input ref={ref} className={`${fieldClass} ${className}`} {...props} />
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
});

export function SelectField({
  label,
  error,
  hint,
  className = "",
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select className={`${fieldClass} ${className}`} {...props}>
        {children}
      </select>
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function TextareaField({
  label,
  error,
  hint,
  className = "",
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
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
  ...props
}: FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-300 bg-white px-3 py-3 ${className}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        {...props}
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
        {error && <span className="block text-xs text-red-600">{error}</span>}
      </span>
    </label>
  );
}
