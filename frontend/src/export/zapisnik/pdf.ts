/* PDF backend for the zapisnik export. Mirrors the TournamentExport capture
   mechanism: mount the fixed-size A4 sheet in a hidden off-screen container,
   snapshot it with html-to-image at 2x, place the PNG on a single jsPDF A4
   page and hand back the Blob. Static imports of html-to-image / jspdf are
   fine here - callers dynamic-import this whole module. */

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import type { ZapisnikData } from "./types";
import { ZapisnikSheet } from "./ZapisnikSheet";

const SHEET_W_PX = 794;
const A4_W_MM = 210;
const A4_H_MM = 297;

function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)));
    });
}

/** Wait until React has committed the sheet and the browser laid it out
 *  (bounded - gives up after ~1.5 s and lets the caller's null check fire). */
async function awaitSheet(container: HTMLElement): Promise<HTMLElement | null> {
    for (let i = 0; i < 10; i++) {
        await nextFrame();
        const node = container.firstElementChild as HTMLElement | null;
        if (node && node.offsetHeight > 0) return node;
    }
    return container.firstElementChild as HTMLElement | null;
}

export async function generateZapisnikPdf(data: ZapisnikData): Promise<Blob> {
    // Hidden capture container - off-screen (not display:none, the browser
    // must actually lay the sheet out for html-to-image to see it).
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "0";
    container.style.width = `${SHEET_W_PX}px`;
    document.body.appendChild(container);

    const root = createRoot(container);
    try {
        root.render(createElement(ZapisnikSheet, { data }));
        const node = await awaitSheet(container);
        if (!node) throw new Error("Zapisnik sheet failed to mount");

        const url = await toPng(node, {
            pixelRatio: 2,
            backgroundColor: "#FFFFFF",
            cacheBust: true,
        });

        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        pdf.addImage(url, "PNG", 0, 0, A4_W_MM, A4_H_MM, undefined, "FAST");
        return pdf.output("blob");
    } finally {
        root.unmount();
        container.remove();
    }
}
