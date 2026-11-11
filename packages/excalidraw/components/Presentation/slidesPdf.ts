import { getNonDeletedElements } from "@excalidraw/element";

import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { exportScene } from "../../scene/export";

import type { AppClassProperties } from "../../types";

/** the slides are rendered at twice their size, for sharp pages */
const PDF_SLIDE_SCALE = 2;
const PDF_JPEG_QUALITY = 0.92;
/** CSS pixels to PDF points */
const PX_TO_PT = 0.75;

type PdfPage = {
  /** baseline JPEG, embedded as is (`DCTDecode`) */
  jpeg: Uint8Array;
  /** page size, in points */
  width: number;
  height: number;
};

/** pixel size and color components of a JPEG, from its frame header */
export const getJpegInfo = (jpeg: Uint8Array) => {
  let offset = 2; // after the SOI marker
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      break;
    }
    const marker = jpeg[offset + 1];
    const length = (jpeg[offset + 2] << 8) | jpeg[offset + 3];
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: (jpeg[offset + 5] << 8) | jpeg[offset + 6],
        width: (jpeg[offset + 7] << 8) | jpeg[offset + 8],
        components: jpeg[offset + 9],
      };
    }
    offset += 2 + length;
  }
  throw new Error("Invalid JPEG");
};

const formatNumber = (value: number) => String(Math.round(value * 100) / 100);

/** a PDF with one page per image, each filling its page */
export const createImagesPdf = (pages: readonly PdfPage[]) => {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];

  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const writeObject = (id: number, ...parts: (string | Uint8Array)[]) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
    parts.forEach(write);
    write("\nendobj\n");
  };

  // the binary comment tells tools the file isn't plain text
  write("%PDF-1.4\n%âãÏÓ\n");
  // 1: catalog, 2: page tree, then 3 objects per page
  const pageId = (index: number) => 3 + index * 3;
  writeObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeObject(
    2,
    `<< /Type /Pages /Kids [${pages
      .map((_, index) => `${pageId(index)} 0 R`)
      .join(" ")}] /Count ${pages.length} >>`,
  );
  pages.forEach((page, index) => {
    const id = pageId(index);
    const width = formatNumber(page.width);
    const height = formatNumber(page.height);
    const image = getJpegInfo(page.jpeg);
    const drawImage = `q ${width} 0 0 ${height} 0 0 cm /Slide Do Q`;
    writeObject(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] `,
      `/Resources << /XObject << /Slide ${id + 2} 0 R >> >> `,
      `/Contents ${id + 1} 0 R >>`,
    );
    writeObject(
      id + 1,
      `<< /Length ${drawImage.length} >>\nstream\n${drawImage}\nendstream`,
    );
    writeObject(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${image.width} `,
      `/Height ${image.height} /ColorSpace /${
        image.components === 1 ? "DeviceGray" : "DeviceRGB"
      } /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      "\nstream\n",
      page.jpeg,
      "\nendstream",
    );
  });

  const xrefOffset = length;
  const objectCount = pageId(pages.length);
  write(
    `xref\n0 ${objectCount}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size ${objectCount} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
};

/** a PDF of the slides, one page per frame, in the given order */
export const exportSlidesToPdf = async (
  app: AppClassProperties,
  frames: readonly NonDeleted<ExcalidrawFrameLikeElement>[],
) => {
  const elements = getNonDeletedElements(
    app.scene.getElementsIncludingDeleted(),
  );
  const { viewBackgroundColor } = app.state;
  const pages: PdfPage[] = [];
  for (const frame of frames) {
    const blob = await exportScene({
      type: "jpeg",
      data: { elements, appState: { viewBackgroundColor }, files: app.files },
      config: {
        exportingFrame: frame,
        scale: PDF_SLIDE_SCALE,
        quality: PDF_JPEG_QUALITY,
        // JPEG has no transparency
        canvasBackgroundColor:
          viewBackgroundColor && viewBackgroundColor !== "transparent"
            ? viewBackgroundColor
            : "#ffffff",
      },
    });
    pages.push({
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      width: frame.width * PX_TO_PT,
      height: frame.height * PX_TO_PT,
    });
  }
  return createImagesPdf(pages);
};

/** saves the file with the browser's download (or the macOS app's dialog) */
export const downloadBlob = (
  blob: Blob,
  fileName: string,
  ownerDocument: Document,
) => {
  const url = URL.createObjectURL(blob);
  const link = ownerDocument.createElement("a");
  link.href = url;
  link.download = fileName;
  ownerDocument.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
