import {
  createImagesPdf,
  getJpegInfo,
} from "../components/Presentation/slidesPdf";

/** the start of a JPEG: SOI, an APP0 segment and a baseline frame header */
const fakeJpeg = (width: number, height: number, components = 3) =>
  new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00, // APP0 (2 bytes of data)
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length, precision
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    components,
    ...new Array(9).fill(0),
    0xff,
    0xd9, // EOI
  ]);

const readBlob = (blob: Blob) =>
  new Promise<Uint8Array>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

describe("getJpegInfo", () => {
  it("reads the size and color components of a JPEG", () => {
    expect(getJpegInfo(fakeJpeg(1600, 900))).toEqual({
      width: 1600,
      height: 900,
      components: 3,
    });
    expect(getJpegInfo(fakeJpeg(10, 20, 1)).components).toBe(1);
    expect(() => getJpegInfo(new Uint8Array([0xff, 0xd8, 0, 0]))).toThrow(
      "Invalid JPEG",
    );
  });
});

describe("createImagesPdf", () => {
  it("makes one page per image, sized as given, with a valid xref", async () => {
    const pdf = createImagesPdf([
      { jpeg: fakeJpeg(1600, 1200), width: 600, height: 450 },
      { jpeg: fakeJpeg(800, 800, 1), width: 300, height: 300.004 },
    ]);
    expect(pdf.type).toBe("application/pdf");
    const bytes = await readBlob(pdf);
    const text = new TextDecoder("latin1").decode(bytes);

    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Type /Pages /Kids [3 0 R 6 0 R] /Count 2");
    expect(text).toContain("/MediaBox [0 0 600 450]");
    expect(text).toContain("/MediaBox [0 0 300 300]");
    expect(text).toContain("/Width 1600 /Height 1200 /ColorSpace /DeviceRGB");
    expect(text).toContain("/Width 800 /Height 800 /ColorSpace /DeviceGray");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);

    // every xref entry points at its object
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = text
      .slice(startxref)
      .split("\n")
      .slice(3, 3 + 7)
      .map((line) => Number(line.slice(0, 10)));
    entries.forEach((offset, index) => {
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });
});
