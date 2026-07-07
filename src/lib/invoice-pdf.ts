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

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "pt", "letter");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgHeight = (canvas.height * pageWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, pageWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, pageWidth, imgHeight);
    heightLeft -= pageHeight;
  }

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
