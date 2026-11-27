/**
 * Test images for the drink photo specs (r110 drinks-g3): a JPEG, PNG and WebP each carrying EXIF with a GPS
 * IFD, XMP and text, as a phone writes them. Test-only, like dishes.testing.ts.
 */
export const seg = (marker: number, payload: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};
/** An EXIF block naming a GPS IFD (tag 0x8825) and a latitude, as a phone writes it. */
export const EXIF = Buffer.concat([Buffer.from("Exif\0\0MM\0*\0\0\0\x08\0\x01", "latin1"), Buffer.from([0x88, 0x25, 0, 4, 0, 0, 0, 1]), Buffer.from("GPSLatitude 36.88N", "latin1")]);
export const jpegWithGps = () =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    seg(0xe1, EXIF),
    seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPS</x:xmpmeta>", "latin1")),
    seg(0xe2, Buffer.from("MPF\0secondimage", "latin1")),
    seg(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01colour", "latin1")),
    seg(0xfe, Buffer.from("taken at the bar", "latin1")),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]),
    Buffer.from([0xff, 0xd9]),
    // What a phone appends after the image: a second JPEG with its own EXIF.
    Buffer.from([0xff, 0xd8]),
    seg(0xe1, EXIF),
    Buffer.from([0xff, 0xd9]),
  ]);

const crc0 = Buffer.alloc(4);
const pngChunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, crc0]);
};
export const pngWithGps = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.alloc(13, 1)),
    pngChunk("eXIf", EXIF.subarray(6)),
    pngChunk("tEXt", Buffer.from("GPS\x0036.88N", "latin1")),
    pngChunk("IDAT", Buffer.from([1, 2, 3])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

const riffChunk = (fourcc: string, data: Buffer) => {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length, 0);
  return Buffer.concat([Buffer.from(fourcc, "latin1"), size, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
};
export const webpWithGps = () => {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04; // EXIF and XMP follow
  const body = Buffer.concat([riffChunk("VP8X", vp8x), riffChunk("VP8 ", Buffer.alloc(11, 2)), riffChunk("EXIF", EXIF.subarray(6)), riffChunk("XMP ", Buffer.from("<x>GPS</x>", "latin1"))]);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
};

export const hasGps = (b: Buffer) => b.includes(Buffer.from("Exif", "latin1")) || b.includes(Buffer.from([0x88, 0x25])) || b.includes(Buffer.from("GPS", "latin1"));

