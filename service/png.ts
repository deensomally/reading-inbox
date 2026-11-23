import { crc32, inflateSync } from "node:zlib";

// Only bounded, non-animated 8-bit PNGs that decode to the declared raster are retained.
export function readablePng(bytes: Buffer) {
  if (
    bytes.length < 57 ||
    bytes.length > 96 * 1024 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    return false;
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  const channels: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const count = channels[bytes[25]];
  if (
    !count ||
    width < 2 ||
    width > 2048 ||
    height < 2 ||
    height > 2048 ||
    width * height > 1000000 ||
    bytes[24] !== 8 ||
    !bytes.subarray(26, 29).equals(Buffer.alloc(3))
  )
    return false;
  const parts: Buffer[] = [];
  for (let p = 8; p + 12 <= bytes.length;) {
    const len = bytes.readUInt32BE(p),
      end = p + 8 + len;
    if (
      end + 4 > bytes.length ||
      crc32(bytes.subarray(p + 4, end)) !== bytes.readUInt32BE(end)
    )
      return false;
    const type = bytes.toString("ascii", p + 4, p + 8);
    if (type === "acTL" || (type === "IHDR" && p !== 8)) return false;
    if (type === "IDAT") parts.push(bytes.subarray(p + 8, end));
    if (type === "IEND") {
      if (len || end + 4 !== bytes.length || !parts.length) return false;
      try {
        const stride = width * count + 1;
        const data = inflateSync(Buffer.concat(parts), {
          maxOutputLength: stride * height,
        });
        if (data.length !== stride * height) return false;
        for (let offset = 0; offset < data.length; offset += stride)
          if (data[offset] > 4) return false;
        return true;
      } catch {
        return false;
      }
    }
    p = end + 4;
  }
  return false;
}
