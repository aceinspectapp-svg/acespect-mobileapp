declare module 'heic-convert' {
  /** Decodes a HEIC/HEIF image (pure JavaScript / WebAssembly, no native codec needed) into a JPEG or PNG. */
  export default function convert(options: { buffer: Buffer | Uint8Array; format: 'JPEG' | 'PNG'; quality?: number }): Promise<ArrayBuffer>;
}
