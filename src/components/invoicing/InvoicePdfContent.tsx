"use client";

import { forwardRef } from "react";
import {
  formatInvoiceDisplayDate,
  getInvoiceLineBreakdown,
  sumInvoiceLineBreakdowns,
  type InvoiceLineItem,
} from "@/lib/invoice-utils";
import { formatQuantity, normalizeQuantity } from "@/lib/utils";

const PINK = "#ef559e";
const CORAL = "#f04c4c";
const MIN_ROWS = 10;

const TERMS_PARAGRAPHS = [
  "Pricing is only valid for 14 days and Designer is not responsible for changes in vendor pricing.",
  "Note: Payment methods accepted include cash, checks, all major credit cards and Venmo. Please note Venmo payments require an additional 2.3% processing fee and Credit Card Payments require an additional 2.6% processing fee.",
  "Invoice payments are due within seven (7) calendar days. Payments more than ten (10) calendar days late incur a late fee of 1.5% per month (18% annually) or the maximum allowed by law, whichever is less, and pricing adjustments may be required.",
  "Client authorizes Designer to purchase the products listed below and agrees to provide payment in full to initiate the purchase. Ownership of all goods transfers from Designer to Client when invoices are paid in full to include shipping, taxes, storage, and freight.",
  "Designer purchases on behalf of the client and the manufacturer's warranty applies. The Designer may provide assistance working with a supplier should it be required. Not liable for third-party trade errors. Late payments automatically pause the project timeline. Title to goods does not transfer to Client until paid in full.",
];

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export interface InvoicePdfContentProps {
  clientName: string;
  location: string;
  invoiceNumber: string;
  projectName: string;
  invoiceDate?: string | Date | null;
  lines: InvoiceLineItem[];
}

export const InvoicePdfContent = forwardRef<HTMLDivElement, InvoicePdfContentProps>(
  function InvoicePdfContent(
    { clientName, location, invoiceNumber, projectName, invoiceDate, lines },
    ref
  ) {
    const totals = sumInvoiceLineBreakdowns(lines);
    const displayDate = formatInvoiceDisplayDate(invoiceDate);
    const rowCount = Math.max(MIN_ROWS, lines.length);

    return (
      <div
        ref={ref}
        style={{
          width: "8.5in",
          minHeight: "11in",
          boxSizing: "border-box",
          fontFamily: "Arial, Helvetica, sans-serif",
          color: "#111",
          background: "#fff",
          padding: "0 0.45in 0.35in",
        }}
      >
        <div
          style={{
            height: "10px",
            background: CORAL,
            margin: "0 -0.45in 0.2in",
          }}
        />

        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: "0.15in" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/maison-joy-logo.png"
            alt="Maison Joy"
            style={{ width: "2.1in", height: "auto" }}
          />
        </div>

        <h1
          style={{
            margin: "0 0 0.2in",
            fontSize: "28pt",
            fontWeight: 700,
            color: PINK,
            letterSpacing: "0.04em",
          }}
        >
          INVOICE
        </h1>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.12in 0.4in",
            marginBottom: "0.2in",
            fontSize: "10pt",
          }}
        >
          <div>
            <div style={{ marginBottom: "0.08in" }}>
              <span style={{ color: PINK, fontWeight: 700 }}>Client Name: </span>
              <span>{clientName || "—"}</span>
            </div>
            <div style={{ marginBottom: "0.08in" }}>
              <span style={{ color: PINK, fontWeight: 700 }}>Project Name: </span>
              <span>{projectName || "—"}</span>
            </div>
            <div>
              <span style={{ color: PINK, fontWeight: 700 }}>Location: </span>
              <span>{location || "—"}</span>
            </div>
          </div>
          <div>
            <div style={{ marginBottom: "0.08in" }}>
              <span style={{ color: PINK, fontWeight: 700 }}>Date: </span>
              <span>{displayDate}</span>
            </div>
            <div>
              <span style={{ color: PINK, fontWeight: 700 }}>Invoice #: </span>
              <span>{invoiceNumber || "—"}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #111",
            padding: "0.12in 0.14in",
            marginBottom: "0.2in",
            fontSize: "7.5pt",
            fontStyle: "italic",
            lineHeight: 1.45,
          }}
        >
          {TERMS_PARAGRAPHS.map((paragraph, index) => (
            <p key={index} style={{ margin: index === 0 ? 0 : "0.08in 0 0" }}>
              {index === 1 ? (
                <>
                  <strong>Note: </strong>
                  {paragraph.replace(/^Note:\s*/, "")}
                </>
              ) : (
                paragraph
              )}
            </p>
          ))}
        </div>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "9pt",
            marginBottom: "0.15in",
          }}
        >
          <thead>
            <tr>
              {[
                { label: "Description", align: "left" as const },
                { label: "Qty", align: "center" as const },
                { label: "Price", align: "right" as const },
                { label: "Subtotal", align: "right" as const },
              ].map(({ label, align }) => (
                <th
                  key={label}
                  style={{
                    border: "1px solid #111",
                    padding: "5px 6px",
                    color: PINK,
                    fontWeight: 700,
                    textAlign: align,
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }).map((_, index) => {
              const line = lines[index];
              if (!line) {
                return (
                  <tr key={`empty-${index}`}>
                    {Array.from({ length: 4 }).map((__, col) => (
                      <td
                        key={col}
                        style={{
                          border: "1px solid #111",
                          padding: "7px 6px",
                          height: "22px",
                        }}
                      />
                    ))}
                  </tr>
                );
              }

              const breakdown = getInvoiceLineBreakdown(line);
              const qty = normalizeQuantity(Number(line.quantity) || 1);
              const unitPrice = qty > 0 ? breakdown.merchandise / qty : breakdown.merchandise;

              return (
                <tr key={line.id}>
                  <td style={{ border: "1px solid #111", padding: "5px 6px" }}>
                    {line.description?.trim() || "—"}
                  </td>
                  <td style={{ border: "1px solid #111", padding: "5px 6px", textAlign: "center" }}>
                    {formatQuantity(qty)}
                  </td>
                  <td style={{ border: "1px solid #111", padding: "5px 6px", textAlign: "right" }}>
                    {formatMoney(unitPrice)}
                  </td>
                  <td style={{ border: "1px solid #111", padding: "5px 6px", textAlign: "right" }}>
                    {formatMoney(breakdown.merchandise)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.35in" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "9pt", minWidth: "2.6in" }}>
            <tbody>
              {[
                ["Product Subtotal:", totals.merchandise],
                ["Shipping:", totals.shipping],
                ["Taxes:", totals.tax],
                ["Payment Fee:", totals.paymentFee],
                ["Grand Total:", totals.total, true],
              ].map(([label, amount, bold]) => (
                <tr key={String(label)}>
                  <td
                    style={{
                      color: PINK,
                      fontWeight: 700,
                      textAlign: "right",
                      padding: "4px 8px 4px 0",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </td>
                  <td
                    style={{
                      border: "1px solid #111",
                      padding: "4px 8px",
                      textAlign: "right",
                      minWidth: "0.9in",
                      fontWeight: bold ? 700 : 400,
                    }}
                  >
                    {formatMoney(Number(amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p
          style={{
            textAlign: "center",
            color: PINK,
            fontSize: "14pt",
            fontWeight: 700,
            fontStyle: "italic",
            margin: "0.25in 0 0",
          }}
        >
          Thank you for your putting your trust in us!!! XOXO
        </p>
      </div>
    );
  }
);
