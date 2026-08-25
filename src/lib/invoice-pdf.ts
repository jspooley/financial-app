"use client";

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export function invoicePdfFilename(invoiceId: string): string {
  const safe = invoiceId.replace(/[^\w.-]+/g, "_");
  return `Invoice-${safe}.pdf`;
}

async function waitForImages(element: HTMLElement): Promise<void> {
  const images = Array.from(element.querySelectorAll("img"));
  if (images.length === 0) return;

  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        })
    )
  );
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

type KeepRange = { start: number; end: number };

function canvasKeepRanges(
  element: HTMLElement,
  canvas: HTMLCanvasElement
): KeepRange[] {
  const scale = canvas.height / Math.max(element.scrollHeight, 1);
  const rootRect = element.getBoundingClientRect();
  const ranges: KeepRange[] = [];

  for (const node of element.querySelectorAll("[data-pdf-keep], tr")) {
    const rect = node.getBoundingClientRect();
    const start = (rect.top - rootRect.top) * scale;
    const end = (rect.bottom - rootRect.top) * scale;
    if (end - start > 1) ranges.push({ start, end });
  }

  return ranges.sort((a, b) => a.start - b.start);
}

function pageSlices(
  canvasHeight: number,
  pageHeightPx: number,
  keeps: KeepRange[]
): { y: number; height: number }[] {
  const slices: { y: number; height: number }[] = [];
  let y = 0;

  while (y < canvasHeight - 0.5) {
    let next = Math.min(y + pageHeightPx, canvasHeight);
    if (next < canvasHeight - 0.5) {
      const hit = keeps.find((keep) => next > keep.start + 1 && next < keep.end - 1);
      if (hit && hit.start > y + 16) {
        next = hit.start;
      }
    }
    slices.push({ y, height: Math.max(1, next - y) });
    y = next;
  }

  return slices;
}

function cropCanvas(
  canvas: HTMLCanvasElement,
  y: number,
  height: number
): HTMLCanvasElement {
  const slice = document.createElement("canvas");
  const sliceHeight = Math.max(1, Math.min(Math.ceil(height), canvas.height - Math.floor(y)));
  slice.width = canvas.width;
  slice.height = sliceHeight;
  const ctx = slice.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(
    canvas,
    0,
    Math.floor(y),
    canvas.width,
    sliceHeight,
    0,
    0,
    canvas.width,
    sliceHeight
  );
  return slice;
}

async function renderElementToPdf(element: HTMLElement): Promise<jsPDF> {
  await waitForImages(element);
  await waitForPaint();

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: 0,
    width: element.scrollWidth,
    height: element.scrollHeight,
  });

  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error("PDF content could not be rendered. Try again after the page finishes loading.");
  }

  const pdf = new jsPDF("p", "pt", "letter");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageHeightPx = (pageHeight / pageWidth) * canvas.width;
  const slices = pageSlices(
    canvas.height,
    pageHeightPx,
    canvasKeepRanges(element, canvas)
  );

  slices.forEach((slice, index) => {
    if (index > 0) pdf.addPage();
    const cropped = cropCanvas(canvas, slice.y, slice.height);
    const imgHeight = (cropped.height * pageWidth) / cropped.width;
    pdf.addImage(cropped.toDataURL("image/png"), "PNG", 0, 0, pageWidth, imgHeight);
  });

  return pdf;
}

export async function renderElementToPdfBlob(element: HTMLElement): Promise<Blob> {
  const pdf = await renderElementToPdf(element);
  return pdf.output("blob");
}

export async function saveInvoicePdf(element: HTMLElement, filename: string): Promise<void> {
  const pdf = await renderElementToPdf(element);
  pdf.save(filename);
}

export function printInvoicePdf(element: HTMLElement, title: string): void {
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) {
    alert("Pop-up blocked. Allow pop-ups to print this invoice.");
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: letter; margin: 0.35in; }
      body { margin: 0; background: #fff; }
      img { max-width: 100%; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tr, [data-pdf-keep] {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    </style>
  </head>
  <body>${element.outerHTML}</body>
</html>`);
  printWindow.document.close();

  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  const images = printWindow.document.images;
  if (images.length === 0) {
    triggerPrint();
    return;
  }

  let loaded = 0;
  const onReady = () => {
    loaded += 1;
    if (loaded >= images.length) triggerPrint();
  };

  for (const image of images) {
    if (image.complete) onReady();
    else {
      image.addEventListener("load", onReady);
      image.addEventListener("error", onReady);
    }
  }
}
