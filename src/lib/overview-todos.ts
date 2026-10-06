import {
  getLedgerUnderpaymentAmount,
  isInvoicedDebitLine,
  isLedgerLineUnpaid,
  isToBeInvoicedLine,
} from "./invoice-utils";
import { isPendingProposalSent, type LedgerEntry } from "./types";
import {
  formatCurrency,
  getLedgerInvoicedAmountExcludingPaymentFee,
  parseDateOnlyParts,
  roundMoney,
} from "./utils";

export type OverviewAutoTodo = {
  sourceKey: string;
  task: string;
  /** Set when the due date comes from a source date, such as proposal sent. */
  dueDate?: string;
};

function clientName(entry: LedgerEntry) {
  const name = entry.clients?.name?.trim();
  return name || "Client";
}

function addDaysFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Due date used when an outstanding payment or invoice is first added. */
export function overviewTodoDueDate() {
  return addDaysFromToday(7);
}

function formatCalendarDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addCalendarDays(isoDate: string, days: number) {
  const parts = parseDateOnlyParts(isoDate);
  if (!parts) return overviewTodoDueDate();
  const date = new Date(parts.year, parts.month - 1, parts.day);
  date.setDate(date.getDate() + days);
  return formatCalendarDate(date);
}

function localCalendarDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatCalendarDate(date);
}

export type ProposalFollowUpAppointment = {
  id: string;
  client_name: string | null;
  proposal_sent?: boolean | null;
  job_won?: boolean | null;
  job_lost?: boolean | null;
  proposal_sent_date?: string | null;
  updated_at?: string | null;
};

/** Follow up is due 7 days after the proposal was sent. */
export function buildProposalFollowUpTodos(
  appointments: ProposalFollowUpAppointment[]
): OverviewAutoTodo[] {
  const todos: OverviewAutoTodo[] = [];
  for (const appointment of appointments) {
    if (
      !isPendingProposalSent({
        proposal_sent: Boolean(appointment.proposal_sent),
        job_won: Boolean(appointment.job_won),
        job_lost: Boolean(appointment.job_lost),
      })
    ) {
      continue;
    }
    const sentDate =
      (appointment.proposal_sent_date
        ? parseDateOnlyParts(appointment.proposal_sent_date) &&
          appointment.proposal_sent_date.slice(0, 10)
        : "") || localCalendarDate(appointment.updated_at);
    if (!sentDate) continue;
    const client = appointment.client_name?.trim() || "Client";
    todos.push({
      sourceKey: `proposal:${appointment.id}`,
      task: `Proposal follow up — ${client}`,
      dueDate: addCalendarDays(sentDate, 7),
    });
  }
  return todos.sort((a, b) => a.task.localeCompare(b.task));
}

export type SendProposalAppointment = {
  id: string;
  client_name: string | null;
  appointment_date?: string | null;
  send_proposal?: boolean | null;
  proposal_sent?: boolean | null;
  job_won?: boolean | null;
  job_lost?: boolean | null;
};

/** Send-proposal to-do is due 7 days after the appointment date. */
export function buildSendProposalTodos(
  appointments: SendProposalAppointment[]
): OverviewAutoTodo[] {
  const todos: OverviewAutoTodo[] = [];
  for (const appointment of appointments) {
    if (!appointment.send_proposal) continue;
    if (appointment.proposal_sent || appointment.job_won || appointment.job_lost) continue;
    const appointmentDate = (appointment.appointment_date ?? "").slice(0, 10);
    if (!parseDateOnlyParts(appointmentDate)) continue;
    const client = appointment.client_name?.trim() || "Client";
    todos.push({
      sourceKey: `send-proposal:${appointment.id}`,
      task: `Send proposal — ${client}`,
      dueDate: addCalendarDays(appointmentDate, 7),
    });
  }
  return todos.sort((a, b) => a.task.localeCompare(b.task));
}

export type SendBudgetAppointment = {
  id: string;
  client_name: string | null;
  appointment_date?: string | null;
  send_budget?: boolean | null;
  job_won?: boolean | null;
  job_lost?: boolean | null;
};

/** Send-budget to-do is due 7 days after the appointment date. */
export function buildSendBudgetTodos(
  appointments: SendBudgetAppointment[]
): OverviewAutoTodo[] {
  const todos: OverviewAutoTodo[] = [];
  for (const appointment of appointments) {
    if (!appointment.send_budget || appointment.job_won || appointment.job_lost) continue;
    const appointmentDate = (appointment.appointment_date ?? "").slice(0, 10);
    if (!parseDateOnlyParts(appointmentDate)) continue;
    const client = appointment.client_name?.trim() || "Client";
    todos.push({
      sourceKey: `send-budget:${appointment.id}`,
      task: `Send budget — ${client}`,
      dueDate: addCalendarDays(appointmentDate, 7),
    });
  }
  return todos.sort((a, b) => a.task.localeCompare(b.task));
}

/**
 * One to-do per invoice still to be created (client + PO) and one per
 * unpaid invoice. Amounts match the overview invoicing cards.
 */
export function buildOverviewAutoTodos(entries: LedgerEntry[]): OverviewAutoTodo[] {
  const invoices = new Map<
    string,
    { client: string; po: string; amount: number; count: number }
  >();
  const payments = new Map<string, { label: string; client: string; amount: number }>();

  for (const entry of entries) {
    if (isToBeInvoicedLine(entry)) {
      const amount = getLedgerInvoicedAmountExcludingPaymentFee(entry);
      if (amount < 0.005) continue;
      const clientId = entry.client_id ?? "none";
      const po = (entry.po_number ?? "").trim();
      const key = `${clientId}:${po.toLowerCase()}`;
      const current = invoices.get(key) ?? {
        client: clientName(entry),
        po,
        amount: 0,
        count: 0,
      };
      current.amount = roundMoney(current.amount + amount);
      current.count += 1;
      invoices.set(key, current);
    }

    if (isInvoicedDebitLine(entry) && isLedgerLineUnpaid(entry)) {
      const amount = getLedgerUnderpaymentAmount(entry);
      if (amount < 0.005) continue;
      const invoiceId = (entry.invoice_id ?? "").trim() || entry.id;
      const current = payments.get(invoiceId) ?? {
        label: (entry.invoice_id ?? "").trim() || "invoice",
        client: clientName(entry),
        amount: 0,
      };
      current.amount = roundMoney(current.amount + amount);
      payments.set(invoiceId, current);
    }
  }

  const todos: OverviewAutoTodo[] = [];

  for (const [key, invoice] of invoices) {
    const po = invoice.po ? ` ${invoice.po}` : "";
    const items = invoice.count === 1 ? "1 item" : `${invoice.count} items`;
    todos.push({
      sourceKey: `invoice:${key}`,
      task: `Invoice ${invoice.client}${po} — ${items}, ${formatCurrency(invoice.amount)}`,
    });
  }

  for (const [invoiceId, payment] of payments) {
    todos.push({
      sourceKey: `payment:${invoiceId}`,
      task: `Collect ${formatCurrency(payment.amount)} — ${payment.label} (${payment.client})`,
    });
  }

  return todos.sort((a, b) => a.task.localeCompare(b.task));
}

export function proposalSentDateForSave(options: {
  proposalSent: boolean;
  wasSent: boolean;
  existingSentDate?: string | null;
  updatedAt?: string | null;
}) {
  if (!options.proposalSent) return null;
  if (options.wasSent && options.existingSentDate) {
    const existing = options.existingSentDate.slice(0, 10);
    if (parseDateOnlyParts(existing)) return existing;
  }
  if (options.wasSent && options.updatedAt) {
    const fromUpdate = localCalendarDate(options.updatedAt);
    if (fromUpdate) return fromUpdate;
  }
  return addDaysFromToday(0);
}
