"use client";

import { forwardRef } from "react";
import type { BudgetPlanSnapshot } from "@/lib/budget-utils";

const PINK = "#ef559e";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export interface BudgetPdfContentProps {
  clientName: string;
  poNumber?: string;
  plan: BudgetPlanSnapshot;
}

export const BudgetPdfContent = forwardRef<HTMLDivElement, BudgetPdfContentProps>(
  function BudgetPdfContent({ clientName, poNumber, plan }, ref) {
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
          padding: "0.45in",
        }}
      >
        <div style={{ marginBottom: "0.3in" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/maison-joy-logo.png"
            alt="Maison Joy"
            style={{ width: "1.25in", height: "auto", display: "block" }}
          />
          <h1
            style={{
              margin: "0.18in 0 0",
              fontSize: "20pt",
              fontWeight: 700,
              color: PINK,
              textAlign: "center",
            }}
          >
            Investment Approach for {clientName}
          </h1>
        </div>

        {poNumber ? (
          <p style={{ margin: "0 0 0.25in", fontSize: "11pt", color: "#475569" }}>
            PO {poNumber}
          </p>
        ) : null}

        {plan.notes.trim() ? (
          <p
            style={{
              margin: "0 0 0.28in",
              fontSize: "11pt",
              lineHeight: 1.45,
              color: "#334155",
              whiteSpace: "pre-wrap",
            }}
          >
            {plan.notes.trim()}
          </p>
        ) : null}

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "12pt",
          }}
        >
          <thead>
            <tr style={{ borderBottom: `2px solid ${PINK}` }}>
              <th style={{ textAlign: "left", padding: "0.08in 0", fontWeight: 700 }}>
                Room
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "0.08in 0",
                  fontWeight: 700,
                  width: "1.6in",
                }}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.rooms.map((room) => (
              <tr key={room.room} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "0.12in 0", fontWeight: 600 }}>{room.room}</td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "0.12in 0",
                    fontWeight: 700,
                    color: PINK,
                  }}
                >
                  {formatMoney(room.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            marginTop: "0.35in",
            paddingTop: "0.15in",
            borderTop: `2px solid ${PINK}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <span style={{ fontSize: "14pt", fontWeight: 700 }}>Total Investment</span>
          <span style={{ fontSize: "16pt", fontWeight: 700, color: PINK }}>
            {formatMoney(plan.grandTotal)}
          </span>
        </div>
      </div>
    );
  }
);
