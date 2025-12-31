export function readU64BE(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, false);
}

export function readI64BE(view: DataView, offset: number): bigint {
  return view.getBigInt64(offset, false);
}

export function safeSlice(bytes: Uint8Array, offset: number, length: number): Uint8Array | null {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    return null;
  }
  return bytes.slice(offset, offset + length);
}

export class SafeReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  remaining(): number {
    return this.data.length - this.offset;
  }

  readU8(field: string): number {
    if (this.offset + 1 > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const value = this.data[this.offset];
    this.offset += 1;
    return value;
  }

  readU8At(offset: number, field: string): number {
    if (offset < 0 || offset >= this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${offset}`);
    }
    return this.data[offset];
  }

  readBytes(length: number, field: string): Uint8Array {
    if (length < 0 || this.offset + length > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const slice = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  skip(length: number, field: string): void {
    if (length < 0 || this.offset + length > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    this.offset += length;
  }

  readU64BE(field: string): bigint {
    if (this.offset + 8 > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
    const value = view.getBigUint64(0, false);
    this.offset += 8;
    return value;
  }

  readI64BE(field: string): bigint {
    if (this.offset + 8 > this.data.length) {
      throw new Error(`SafeReader: insufficient data for ${field} at ${this.offset}`);
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
    const value = view.getBigInt64(0, false);
    this.offset += 8;
    return value;
  }
}
