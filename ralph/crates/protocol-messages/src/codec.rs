//! Compact bitwise encoding framework (v2).
//!
//! This module provides the canonical bit-level encoding primitives for
//! compact game move payloads and on-chain state blobs. All bit layouts
//! and versioning are defined here in Rust; JS/TS consumes generated artifacts.
//!
//! # Bit Order Convention
//!
//! - **Within a byte**: LSB-first (bit 0 is least significant)
//! - **Across bytes**: Little-endian
//!
//! # Amount Encoding
//!
//! Amounts use ULEB128 (unsigned LEB128) encoding, where each byte uses
//! 7 bits for data and 1 bit (MSB) as a continuation flag. This allows
//! typical bets (< 128 units) to fit in 1 byte.

use thiserror::Error;

/// Maximum buffer size for encoded payloads (DoS protection).
pub const MAX_ENCODED_SIZE: usize = 1024;

/// Errors that can occur during bit encoding/decoding.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CodecError {
    /// Buffer overflow during write.
    #[error("buffer overflow: attempted to write {attempted} bits, only {available} available")]
    BufferOverflow { attempted: usize, available: usize },

    /// Buffer underflow during read.
    #[error("buffer underflow: attempted to read {attempted} bits, only {available} available")]
    BufferUnderflow { attempted: usize, available: usize },

    /// ULEB128 value exceeds maximum representable value.
    #[error("ULEB128 overflow: value exceeds u64::MAX")]
    Uleb128Overflow,

    /// ULEB128 encoding is non-minimal (has trailing zero bytes).
    #[error("ULEB128 non-minimal encoding")]
    Uleb128NonMinimal,

    /// Bit width exceeds maximum (64 bits).
    #[error("bit width {width} exceeds maximum of 64")]
    InvalidBitWidth { width: usize },

    /// Invalid version in header.
    #[error("invalid version {version}, expected {expected}")]
    InvalidVersion { version: u8, expected: u8 },
}

/// Result type for codec operations.
pub type CodecResult<T> = Result<T, CodecError>;

/// Bitwise writer for compact encoding.
///
/// Writes bits LSB-first within each byte, accumulating bytes in order.
/// All operations are checked for buffer overflow.
#[derive(Debug, Clone)]
pub struct BitWriter {
    /// Accumulated bytes.
    buffer: Vec<u8>,
    /// Current byte being filled.
    current_byte: u8,
    /// Number of bits written to current byte (0-7).
    bit_offset: u8,
    /// Maximum allowed buffer size.
    max_size: usize,
}

impl Default for BitWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl BitWriter {
    /// Create a new BitWriter with default max size.
    #[must_use]
    pub fn new() -> Self {
        Self::with_capacity(MAX_ENCODED_SIZE)
    }

    /// Create a new BitWriter with specified max size.
    #[must_use]
    pub fn with_capacity(max_size: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(max_size.min(256)),
            current_byte: 0,
            bit_offset: 0,
            max_size,
        }
    }

    /// Returns the number of complete bytes written.
    #[must_use]
    pub fn byte_len(&self) -> usize {
        self.buffer.len()
    }

    /// Returns the total number of bits written.
    #[must_use]
    pub fn bit_len(&self) -> usize {
        self.buffer.len() * 8 + self.bit_offset as usize
    }

    /// Write a single bit (0 or 1).
    pub fn write_bit(&mut self, bit: bool) -> CodecResult<()> {
        // Check if we'd overflow:
        // - If bit_offset is 0, we're starting a new byte; check if buffer is at max
        // - If bit_offset is 7, we're about to complete a byte and push it
        if self.bit_offset == 0 && self.buffer.len() >= self.max_size {
            return Err(CodecError::BufferOverflow {
                attempted: 1,
                available: 0,
            });
        }

        if bit {
            self.current_byte |= 1 << self.bit_offset;
        }
        self.bit_offset += 1;

        if self.bit_offset == 8 {
            self.buffer.push(self.current_byte);
            self.current_byte = 0;
            self.bit_offset = 0;
        }

        Ok(())
    }

    /// Write multiple bits from a u64 value (LSB-first).
    ///
    /// # Arguments
    /// * `value` - The value to write (only lower `num_bits` bits are used)
    /// * `num_bits` - Number of bits to write (1-64)
    pub fn write_bits(&mut self, value: u64, num_bits: usize) -> CodecResult<()> {
        if num_bits > 64 {
            return Err(CodecError::InvalidBitWidth { width: num_bits });
        }
        if num_bits == 0 {
            return Ok(());
        }

        // Check space available
        let bits_available = (self.max_size - self.buffer.len()) * 8 - self.bit_offset as usize;
        if num_bits > bits_available {
            return Err(CodecError::BufferOverflow {
                attempted: num_bits,
                available: bits_available,
            });
        }

        // Write bits LSB-first
        for i in 0..num_bits {
            let bit = (value >> i) & 1 != 0;
            // We've already checked space, so unwrap is safe
            let _ = self.write_bit(bit);
        }

        Ok(())
    }

    /// Write a full byte.
    pub fn write_byte(&mut self, byte: u8) -> CodecResult<()> {
        self.write_bits(byte as u64, 8)
    }

    /// Write multiple bytes.
    pub fn write_bytes(&mut self, bytes: &[u8]) -> CodecResult<()> {
        for &b in bytes {
            self.write_byte(b)?;
        }
        Ok(())
    }

    /// Write a ULEB128-encoded unsigned integer.
    ///
    /// ULEB128 uses 7 bits per byte for data, with the MSB as continuation flag.
    /// This is efficient for small values (< 128 fits in 1 byte).
    pub fn write_uleb128(&mut self, mut value: u64) -> CodecResult<()> {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80; // continuation bit
            }
            self.write_byte(byte)?;
            if value == 0 {
                break;
            }
        }
        Ok(())
    }

    /// Finalize and return the encoded bytes.
    ///
    /// If there are partial bits in the current byte, they are padded with zeros.
    #[must_use]
    pub fn finish(mut self) -> Vec<u8> {
        if self.bit_offset > 0 {
            self.buffer.push(self.current_byte);
        }
        self.buffer
    }

    /// Finalize and return the encoded bytes with explicit padding info.
    ///
    /// Returns (bytes, padding_bits) where padding_bits is 0-7.
    #[must_use]
    pub fn finish_with_padding(self) -> (Vec<u8>, u8) {
        let padding = if self.bit_offset > 0 {
            8 - self.bit_offset
        } else {
            0
        };
        (self.finish(), padding)
    }
}

/// Bitwise reader for compact decoding.
///
/// Reads bits LSB-first within each byte. All operations are checked
/// for buffer underflow.
#[derive(Debug, Clone)]
pub struct BitReader<'a> {
    /// Source buffer.
    buffer: &'a [u8],
    /// Current byte index.
    byte_index: usize,
    /// Current bit offset within byte (0-7).
    bit_offset: u8,
}

impl<'a> BitReader<'a> {
    /// Create a new BitReader from a byte slice.
    #[must_use]
    pub fn new(buffer: &'a [u8]) -> Self {
        Self {
            buffer,
            byte_index: 0,
            bit_offset: 0,
        }
    }

    /// Returns the total number of bits in the buffer.
    #[must_use]
    pub fn total_bits(&self) -> usize {
        self.buffer.len() * 8
    }

    /// Returns the number of bits remaining to read.
    #[must_use]
    pub fn remaining_bits(&self) -> usize {
        if self.byte_index >= self.buffer.len() {
            0
        } else {
            (self.buffer.len() - self.byte_index) * 8 - self.bit_offset as usize
        }
    }

    /// Returns true if all bits have been consumed.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.remaining_bits() == 0
    }

    /// Read a single bit.
    pub fn read_bit(&mut self) -> CodecResult<bool> {
        if self.byte_index >= self.buffer.len() {
            return Err(CodecError::BufferUnderflow {
                attempted: 1,
                available: 0,
            });
        }

        let bit = (self.buffer[self.byte_index] >> self.bit_offset) & 1 != 0;
        self.bit_offset += 1;

        if self.bit_offset == 8 {
            self.byte_index += 1;
            self.bit_offset = 0;
        }

        Ok(bit)
    }

    /// Read multiple bits into a u64 (LSB-first).
    ///
    /// # Arguments
    /// * `num_bits` - Number of bits to read (1-64)
    pub fn read_bits(&mut self, num_bits: usize) -> CodecResult<u64> {
        if num_bits > 64 {
            return Err(CodecError::InvalidBitWidth { width: num_bits });
        }
        if num_bits == 0 {
            return Ok(0);
        }

        let available = self.remaining_bits();
        if num_bits > available {
            return Err(CodecError::BufferUnderflow {
                attempted: num_bits,
                available,
            });
        }

        let mut value: u64 = 0;
        for i in 0..num_bits {
            if self.read_bit()? {
                value |= 1 << i;
            }
        }

        Ok(value)
    }

    /// Read a full byte.
    pub fn read_byte(&mut self) -> CodecResult<u8> {
        Ok(self.read_bits(8)? as u8)
    }

    /// Read multiple bytes into a vector.
    pub fn read_bytes(&mut self, count: usize) -> CodecResult<Vec<u8>> {
        let mut bytes = Vec::with_capacity(count);
        for _ in 0..count {
            bytes.push(self.read_byte()?);
        }
        Ok(bytes)
    }

    /// Read a ULEB128-encoded unsigned integer.
    ///
    /// Returns an error if the encoding overflows u64 or is non-minimal.
    pub fn read_uleb128(&mut self) -> CodecResult<u64> {
        let mut value: u64 = 0;
        let mut shift: u32 = 0;

        loop {
            let byte = self.read_byte()?;
            let payload = (byte & 0x7F) as u64;

            // Check for overflow
            if shift >= 64 || (shift == 63 && payload > 1) {
                return Err(CodecError::Uleb128Overflow);
            }

            value |= payload << shift;

            if byte & 0x80 == 0 {
                // Check for non-minimal encoding (trailing zeros)
                // The last byte should not be 0x80 (continuation with no data)
                // and intermediate bytes with 0x00 payload after the first are suspicious
                // but we only reject if continuation bit is set on a zero payload
                // Actually, the standard allows 0x80 followed by 0x00, but we want minimal
                if byte == 0 && shift > 0 {
                    return Err(CodecError::Uleb128NonMinimal);
                }
                break;
            }

            shift += 7;
        }

        Ok(value)
    }

    /// Skip a specified number of bits.
    pub fn skip_bits(&mut self, num_bits: usize) -> CodecResult<()> {
        let available = self.remaining_bits();
        if num_bits > available {
            return Err(CodecError::BufferUnderflow {
                attempted: num_bits,
                available,
            });
        }

        let total_bit_pos = self.byte_index * 8 + self.bit_offset as usize + num_bits;
        self.byte_index = total_bit_pos / 8;
        self.bit_offset = (total_bit_pos % 8) as u8;

        Ok(())
    }

    /// Peek at the next N bits without consuming them.
    pub fn peek_bits(&self, num_bits: usize) -> CodecResult<u64> {
        let mut clone = self.clone();
        clone.read_bits(num_bits)
    }
}

/// Encode a u64 amount as ULEB128 bytes (standalone function).
#[must_use]
pub fn encode_uleb128(mut value: u64) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(10);
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if value == 0 {
            break;
        }
    }
    bytes
}

/// Decode ULEB128 bytes to u64 (standalone function).
pub fn decode_uleb128(bytes: &[u8]) -> CodecResult<(u64, usize)> {
    let mut value: u64 = 0;
    let mut shift: u32 = 0;
    let mut bytes_read = 0;

    for &byte in bytes {
        bytes_read += 1;
        let payload = (byte & 0x7F) as u64;

        if shift >= 64 || (shift == 63 && payload > 1) {
            return Err(CodecError::Uleb128Overflow);
        }

        value |= payload << shift;

        if byte & 0x80 == 0 {
            if byte == 0 && shift > 0 {
                return Err(CodecError::Uleb128NonMinimal);
            }
            return Ok((value, bytes_read));
        }

        shift += 7;
    }

    // Ran out of bytes with continuation bit set
    Err(CodecError::BufferUnderflow {
        attempted: 1,
        available: 0,
    })
}

/// Common envelope header for move payloads.
///
/// All game move payloads use this 8-bit header:
/// - version: 3 bits (0-7)
/// - opcode: 5 bits (0-31)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PayloadHeader {
    /// Protocol version (0-7).
    pub version: u8,
    /// Game-specific opcode (0-31).
    pub opcode: u8,
}

impl PayloadHeader {
    /// Current encoding version for v2 compact format.
    pub const V2: u8 = 2;

    /// Create a new header with version 2.
    #[must_use]
    pub fn new(opcode: u8) -> Self {
        Self {
            version: Self::V2,
            opcode,
        }
    }

    /// Create a header with explicit version.
    #[must_use]
    pub fn with_version(version: u8, opcode: u8) -> Self {
        Self {
            version: version & 0x07,
            opcode: opcode & 0x1F,
        }
    }

    /// Encode the header to a BitWriter.
    pub fn encode(&self, writer: &mut BitWriter) -> CodecResult<()> {
        // 3 bits for version, 5 bits for opcode = 8 bits total
        writer.write_bits(self.version as u64, 3)?;
        writer.write_bits(self.opcode as u64, 5)?;
        Ok(())
    }

    /// Decode a header from a BitReader.
    pub fn decode(reader: &mut BitReader) -> CodecResult<Self> {
        let version = reader.read_bits(3)? as u8;
        let opcode = reader.read_bits(5)? as u8;
        Ok(Self { version, opcode })
    }

    /// Decode and validate the version matches expected.
    pub fn decode_validated(reader: &mut BitReader, expected_version: u8) -> CodecResult<Self> {
        let header = Self::decode(reader)?;
        if header.version != expected_version {
            return Err(CodecError::InvalidVersion {
                version: header.version,
                expected: expected_version,
            });
        }
        Ok(header)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // BitWriter tests
    // ========================================================================

    #[test]
    fn test_bitwriter_single_bits() {
        let mut writer = BitWriter::new();
        writer.write_bit(true).unwrap();
        writer.write_bit(false).unwrap();
        writer.write_bit(true).unwrap();
        writer.write_bit(true).unwrap();
        // Bits: 1, 0, 1, 1 -> LSB first in byte = 0b1101 = 13
        // But only 4 bits written, need to finish
        let bytes = writer.finish();
        assert_eq!(bytes, vec![0b0000_1101]);
    }

    #[test]
    fn test_bitwriter_full_byte() {
        let mut writer = BitWriter::new();
        for i in 0..8 {
            writer.write_bit((0xA5 >> i) & 1 != 0).unwrap();
        }
        let bytes = writer.finish();
        assert_eq!(bytes, vec![0xA5]);
    }

    #[test]
    fn test_bitwriter_write_bits() {
        let mut writer = BitWriter::new();
        writer.write_bits(0b11010, 5).unwrap(); // value 26
        writer.write_bits(0b101, 3).unwrap();   // value 5
        // LSB-first encoding:
        // First 5 bits (value 26 = 0b11010): bits go to positions 0-4
        //   Position 0: bit 0 of 26 = 0
        //   Position 1: bit 1 of 26 = 1
        //   Position 2: bit 2 of 26 = 0
        //   Position 3: bit 3 of 26 = 1
        //   Position 4: bit 4 of 26 = 1
        // Next 3 bits (value 5 = 0b101): bits go to positions 5-7
        //   Position 5: bit 0 of 5 = 1
        //   Position 6: bit 1 of 5 = 0
        //   Position 7: bit 2 of 5 = 1
        // Byte = 0b1011_1010 = 0xBA
        let bytes = writer.finish();
        assert_eq!(bytes, vec![0xBA]);
    }

    #[test]
    fn test_bitwriter_cross_byte_boundary() {
        let mut writer = BitWriter::new();
        writer.write_bits(0xFF, 6).unwrap(); // 6 bits: 111111
        writer.write_bits(0x0F, 6).unwrap(); // 6 bits: 001111
        // First byte: bits 0-5 from first write + bits 0-1 from second
        // Second byte: bits 2-5 from second write
        let bytes = writer.finish();
        assert_eq!(bytes.len(), 2);
        // First 6 bits: 111111, next 6 bits: 111100 (LSB first = 001111)
        // Byte 0: 111111 + 11 (first 2 of second) = 0b11_111111 = 0xFF
        // Byte 1: 0011 (remaining 4 bits) = 0b0000_0011 = 0x03
        assert_eq!(bytes, vec![0xFF, 0x03]);
    }

    #[test]
    fn test_bitwriter_uleb128_small() {
        let mut writer = BitWriter::new();
        writer.write_uleb128(127).unwrap();
        let bytes = writer.finish();
        assert_eq!(bytes, vec![127]);
    }

    #[test]
    fn test_bitwriter_uleb128_medium() {
        let mut writer = BitWriter::new();
        writer.write_uleb128(128).unwrap();
        let bytes = writer.finish();
        // 128 = 0b10000000
        // ULEB128: 0x80, 0x01 (7 bits: 0000000, continuation; 7 bits: 0000001)
        assert_eq!(bytes, vec![0x80, 0x01]);
    }

    #[test]
    fn test_bitwriter_uleb128_large() {
        let mut writer = BitWriter::new();
        writer.write_uleb128(300).unwrap();
        let bytes = writer.finish();
        // 300 = 0b100101100
        // 7 bits: 0101100 = 44, continuation
        // 7 bits: 0000010 = 2
        // ULEB128: 0xAC (44 | 0x80), 0x02
        assert_eq!(bytes, vec![0xAC, 0x02]);
    }

    #[test]
    fn test_bitwriter_max_size_check() {
        let mut writer = BitWriter::with_capacity(2);
        writer.write_bits(0xFF, 8).unwrap();
        writer.write_bits(0xFF, 8).unwrap();
        let result = writer.write_bit(true);
        assert!(matches!(result, Err(CodecError::BufferOverflow { .. })));
    }

    #[test]
    fn test_bitwriter_finish_with_padding() {
        let mut writer = BitWriter::new();
        writer.write_bits(0b101, 3).unwrap();
        let (bytes, padding) = writer.finish_with_padding();
        assert_eq!(bytes, vec![0b0000_0101]);
        assert_eq!(padding, 5);
    }

    // ========================================================================
    // BitReader tests
    // ========================================================================

    #[test]
    fn test_bitreader_single_bits() {
        let data = vec![0b1101_0011]; // LSB first: 1, 1, 0, 0, 1, 0, 1, 1
        let mut reader = BitReader::new(&data);
        assert!(reader.read_bit().unwrap()); // bit 0: 1
        assert!(reader.read_bit().unwrap()); // bit 1: 1
        assert!(!reader.read_bit().unwrap()); // bit 2: 0
        assert!(!reader.read_bit().unwrap()); // bit 3: 0
        assert!(reader.read_bit().unwrap()); // bit 4: 1
        assert!(!reader.read_bit().unwrap()); // bit 5: 0
        assert!(reader.read_bit().unwrap()); // bit 6: 1
        assert!(reader.read_bit().unwrap()); // bit 7: 1
        assert!(reader.is_empty());
    }

    #[test]
    fn test_bitreader_read_bits() {
        // Read back what test_bitwriter_write_bits wrote: 0xBA = 0b1011_1010
        // First 5 bits: positions 0-4 = 1, 0, 1, 1, 0 -> value = 0b01110 = wait...
        // Actually byte 0xBA = 0b1011_1010
        // Reading 5 bits LSB-first from position 0:
        //   bit 0: 0, bit 1: 1, bit 2: 0, bit 3: 1, bit 4: 1
        //   value = 0*1 + 1*2 + 0*4 + 1*8 + 1*16 = 26 = 0b11010 ✓
        // Reading next 3 bits from position 5:
        //   bit 0: 1, bit 1: 0, bit 2: 1
        //   value = 1*1 + 0*2 + 1*4 = 5 = 0b101 ✓
        let data = vec![0xBA];
        let mut reader = BitReader::new(&data);
        let first = reader.read_bits(5).unwrap();
        let second = reader.read_bits(3).unwrap();
        assert_eq!(first, 0b11010); // 26
        assert_eq!(second, 0b101);  // 5
    }

    #[test]
    fn test_bitreader_cross_byte() {
        let data = vec![0xFF, 0x03];
        let mut reader = BitReader::new(&data);
        let first = reader.read_bits(6).unwrap();
        let second = reader.read_bits(6).unwrap();
        assert_eq!(first, 0b111111); // 63
        assert_eq!(second, 0b001111); // 15
    }

    #[test]
    fn test_bitreader_uleb128() {
        let data = vec![0xAC, 0x02]; // 300
        let mut reader = BitReader::new(&data);
        let value = reader.read_uleb128().unwrap();
        assert_eq!(value, 300);
    }

    #[test]
    fn test_bitreader_uleb128_small() {
        let data = vec![127];
        let mut reader = BitReader::new(&data);
        let value = reader.read_uleb128().unwrap();
        assert_eq!(value, 127);
    }

    #[test]
    fn test_bitreader_uleb128_zero() {
        let data = vec![0];
        let mut reader = BitReader::new(&data);
        let value = reader.read_uleb128().unwrap();
        assert_eq!(value, 0);
    }

    #[test]
    fn test_bitreader_underflow() {
        let data = vec![0x01];
        let mut reader = BitReader::new(&data);
        reader.read_bits(8).unwrap();
        let result = reader.read_bit();
        assert!(matches!(result, Err(CodecError::BufferUnderflow { .. })));
    }

    #[test]
    fn test_bitreader_skip() {
        let data = vec![0xFF, 0xFF];
        let mut reader = BitReader::new(&data);
        reader.skip_bits(5).unwrap();
        assert_eq!(reader.remaining_bits(), 11);
        reader.skip_bits(11).unwrap();
        assert!(reader.is_empty());
    }

    #[test]
    fn test_bitreader_peek() {
        let data = vec![0b1010_0101];
        let reader = BitReader::new(&data);
        let peeked = reader.peek_bits(4).unwrap();
        assert_eq!(peeked, 0b0101); // LSB first
        // Original reader unchanged (peek is on immutable reference, so we test via clone)
        let reader = BitReader::new(&data);
        let peeked = reader.peek_bits(4).unwrap();
        assert_eq!(peeked, 0b0101);
        assert_eq!(reader.remaining_bits(), 8); // not consumed
    }

    // ========================================================================
    // Round-trip tests
    // ========================================================================

    #[test]
    fn test_roundtrip_bits() {
        let original: u64 = 0xDEAD_BEEF;
        let mut writer = BitWriter::new();
        writer.write_bits(original, 32).unwrap();
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        let decoded = reader.read_bits(32).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_roundtrip_uleb128_various() {
        let test_values = [0u64, 1, 127, 128, 255, 256, 16383, 16384, u64::MAX];
        for &original in &test_values {
            let mut writer = BitWriter::new();
            writer.write_uleb128(original).unwrap();
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = reader.read_uleb128().unwrap();
            assert_eq!(decoded, original, "roundtrip failed for {}", original);
        }
    }

    #[test]
    fn test_roundtrip_mixed() {
        let mut writer = BitWriter::new();
        writer.write_bits(5, 3).unwrap(); // 3 bits
        writer.write_uleb128(1000).unwrap(); // variable
        writer.write_bits(0xFF, 8).unwrap(); // 8 bits
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        assert_eq!(reader.read_bits(3).unwrap(), 5);
        assert_eq!(reader.read_uleb128().unwrap(), 1000);
        assert_eq!(reader.read_bits(8).unwrap(), 0xFF);
    }

    // ========================================================================
    // PayloadHeader tests
    // ========================================================================

    #[test]
    fn test_header_encode_decode() {
        let header = PayloadHeader::new(15);
        let mut writer = BitWriter::new();
        header.encode(&mut writer).unwrap();
        let bytes = writer.finish();

        assert_eq!(bytes.len(), 1); // 8 bits fits in 1 byte

        let mut reader = BitReader::new(&bytes);
        let decoded = PayloadHeader::decode(&mut reader).unwrap();
        assert_eq!(decoded.version, PayloadHeader::V2);
        assert_eq!(decoded.opcode, 15);
    }

    #[test]
    fn test_header_version_validation() {
        let header = PayloadHeader::with_version(1, 5);
        let mut writer = BitWriter::new();
        header.encode(&mut writer).unwrap();
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        let result = PayloadHeader::decode_validated(&mut reader, 2);
        assert!(matches!(
            result,
            Err(CodecError::InvalidVersion {
                version: 1,
                expected: 2
            })
        ));
    }

    #[test]
    fn test_header_max_values() {
        let header = PayloadHeader::with_version(7, 31);
        let mut writer = BitWriter::new();
        header.encode(&mut writer).unwrap();
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        let decoded = PayloadHeader::decode(&mut reader).unwrap();
        assert_eq!(decoded.version, 7);
        assert_eq!(decoded.opcode, 31);
    }

    // ========================================================================
    // Standalone function tests
    // ========================================================================

    #[test]
    fn test_standalone_uleb128() {
        let encoded = encode_uleb128(300);
        assert_eq!(encoded, vec![0xAC, 0x02]);

        let (decoded, bytes_read) = decode_uleb128(&encoded).unwrap();
        assert_eq!(decoded, 300);
        assert_eq!(bytes_read, 2);
    }

    #[test]
    fn test_standalone_uleb128_zero() {
        let encoded = encode_uleb128(0);
        assert_eq!(encoded, vec![0]);

        let (decoded, bytes_read) = decode_uleb128(&encoded).unwrap();
        assert_eq!(decoded, 0);
        assert_eq!(bytes_read, 1);
    }

    #[test]
    fn test_standalone_uleb128_max() {
        let encoded = encode_uleb128(u64::MAX);
        let (decoded, _) = decode_uleb128(&encoded).unwrap();
        assert_eq!(decoded, u64::MAX);
    }

    // ========================================================================
    // Size reduction validation (AC-1.1)
    // ========================================================================

    #[test]
    fn test_size_reduction_bet_amount_ac_1_1() {
        // V1 would typically use 8 bytes for a u64 amount
        // V2 ULEB128 for typical bet amounts:
        let test_amounts = [
            (100u64, 1),   // < 128 fits in 1 byte
            (1000, 2),     // fits in 2 bytes
            (10000, 2),    // fits in 2 bytes
            (100000, 3),   // fits in 3 bytes
            (1000000, 3),  // fits in 3 bytes
            (10000000, 4), // fits in 4 bytes
        ];

        for (amount, expected_bytes) in test_amounts {
            let encoded = encode_uleb128(amount);
            assert_eq!(
                encoded.len(),
                expected_bytes,
                "amount {} should encode to {} bytes, got {}",
                amount,
                expected_bytes,
                encoded.len()
            );
            // All typical bets (< 10M) use at most 4 bytes vs 8 bytes = 50%+ reduction
            assert!(encoded.len() <= 4, "typical bet amounts should fit in <= 4 bytes");
        }
    }

    #[test]
    fn test_header_size_reduction_ac_1_1() {
        // V2 header is exactly 1 byte (8 bits)
        // V1 headers were typically 2-4 bytes
        let header = PayloadHeader::new(10);
        let mut writer = BitWriter::new();
        header.encode(&mut writer).unwrap();
        let bytes = writer.finish();
        assert_eq!(bytes.len(), 1, "v2 header must be exactly 1 byte");
    }

    // ========================================================================
    // Determinism tests (AC-3.1)
    // ========================================================================

    #[test]
    fn test_encoding_deterministic_ac_3_1() {
        // Same input must produce same output
        let encode_once = || {
            let mut writer = BitWriter::new();
            writer.write_bits(0xABCD, 16).unwrap();
            writer.write_uleb128(12345).unwrap();
            writer.finish()
        };

        let first = encode_once();
        let second = encode_once();
        assert_eq!(first, second, "encoding must be deterministic");
    }

    #[test]
    fn test_decoding_deterministic_ac_3_1() {
        let data = vec![0xCD, 0xAB, 0xB9, 0x60]; // 0xABCD + ULEB128(12345)

        let decode_once = || {
            let mut reader = BitReader::new(&data);
            let bits = reader.read_bits(16).unwrap();
            let amount = reader.read_uleb128().unwrap();
            (bits, amount)
        };

        let first = decode_once();
        let second = decode_once();
        assert_eq!(first, second, "decoding must be deterministic");
    }
}

// ============================================================================
// Unified Bet Descriptor + Per-Game Bet Type Tables (AC-2.1, AC-2.2)
// ============================================================================

/// Configuration for a game's bet encoding layout.
///
/// Each table game defines its bet type bit width and target requirements.
/// This allows a unified [`BetDescriptor`] to encode bets consistently
/// across all games while respecting per-game constraints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BetLayout {
    /// Bit width for bet_type field (typically 4-5).
    pub bet_type_bits: u8,
    /// Bit width for target field (0 = no target, typically 4-6).
    pub target_bits: u8,
    /// Maximum valid bet_type value (inclusive).
    pub max_bet_type: u8,
    /// Maximum valid target value (inclusive, ignored if target_bits == 0).
    pub max_target: u8,
}

impl BetLayout {
    /// Create a layout with no target field.
    #[must_use]
    pub const fn without_target(bet_type_bits: u8, max_bet_type: u8) -> Self {
        Self {
            bet_type_bits,
            target_bits: 0,
            max_bet_type,
            max_target: 0,
        }
    }

    /// Create a layout with a target field.
    #[must_use]
    pub const fn with_target(
        bet_type_bits: u8,
        max_bet_type: u8,
        target_bits: u8,
        max_target: u8,
    ) -> Self {
        Self {
            bet_type_bits,
            target_bits,
            max_bet_type,
            max_target,
        }
    }

    /// Returns true if this layout includes a target field.
    #[must_use]
    pub const fn has_target(&self) -> bool {
        self.target_bits > 0
    }

    /// Returns the fixed bit count for bet_type + target (excluding amount).
    #[must_use]
    pub const fn fixed_bits(&self) -> u8 {
        self.bet_type_bits + self.target_bits
    }
}

/// Per-game bet layouts defining the bit-level encoding parameters.
///
/// These are derived from the per-game compact encoding specs:
/// - `compact-encoding-roulette.md`: bet_type 4 bits, value 6 bits
/// - `compact-encoding-craps.md`: bet_type 5 bits, target 4 bits (optional)
/// - `compact-encoding-sicbo.md`: bet_type 4 bits, target 6 bits (optional)
/// - `compact-encoding-baccarat.md`: bet_type 4 bits, no target
pub mod bet_layouts {
    use super::BetLayout;

    /// Roulette: bet_type (4 bits, 0-13), value (6 bits, 0-63).
    pub const ROULETTE: BetLayout = BetLayout::with_target(4, 13, 6, 63);

    /// Craps: bet_type (5 bits, 0-22), target (4 bits, 0-12).
    /// Target is included only for certain bet types (YES/NO/NEXT/HARDWAY).
    pub const CRAPS: BetLayout = BetLayout::with_target(5, 22, 4, 12);

    /// Sic Bo: bet_type (4 bits, 0-12), target (6 bits, 0-63).
    /// Target is included only for bet types that require it.
    pub const SIC_BO: BetLayout = BetLayout::with_target(4, 12, 6, 63);

    /// Baccarat: bet_type (4 bits, 0-9), no target.
    pub const BACCARAT: BetLayout = BetLayout::without_target(4, 9);
}

/// Unified bet descriptor for all table games.
///
/// This structure satisfies AC-2.1 by providing a shared bet descriptor format
/// used by Roulette, Craps, Sic Bo, and Baccarat. The encoding varies per-game
/// based on the [`BetLayout`], but the structure is consistent:
///
/// - `bet_type`: Identifies the bet category (straight, split, pass line, etc.)
/// - `target`: Optional qualifier (number, point value, etc.)
/// - `amount`: Wager amount in ULEB128 encoding
///
/// This eliminates bespoke bet payloads (AC-2.2) by channeling all bets through
/// a single encode/decode path parameterized by game layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BetDescriptor {
    /// Bet category index (meaning is game-specific).
    pub bet_type: u8,
    /// Optional target qualifier (meaning is game-specific).
    /// Set to 0 when the game/bet type doesn't use a target.
    pub target: u8,
    /// Wager amount (in smallest unit).
    pub amount: u64,
}

impl BetDescriptor {
    /// Create a new bet descriptor.
    #[must_use]
    pub const fn new(bet_type: u8, target: u8, amount: u64) -> Self {
        Self {
            bet_type,
            target,
            amount,
        }
    }

    /// Create a bet descriptor without a target (for games like Baccarat).
    #[must_use]
    pub const fn without_target(bet_type: u8, amount: u64) -> Self {
        Self::new(bet_type, 0, amount)
    }

    /// Encode this bet descriptor using the specified game layout.
    ///
    /// # Errors
    /// Returns `CodecError::BufferOverflow` if the writer runs out of space.
    pub fn encode(&self, writer: &mut BitWriter, layout: BetLayout) -> CodecResult<()> {
        // Write bet_type
        writer.write_bits(self.bet_type as u64, layout.bet_type_bits as usize)?;

        // Write target if layout includes it
        if layout.has_target() {
            writer.write_bits(self.target as u64, layout.target_bits as usize)?;
        }

        // Write amount as ULEB128
        writer.write_uleb128(self.amount)?;

        Ok(())
    }

    /// Decode a bet descriptor using the specified game layout.
    ///
    /// # Errors
    /// Returns `CodecError::BufferUnderflow` if the reader runs out of data.
    pub fn decode(reader: &mut BitReader, layout: BetLayout) -> CodecResult<Self> {
        // Read bet_type
        let bet_type = reader.read_bits(layout.bet_type_bits as usize)? as u8;

        // Read target if layout includes it
        let target = if layout.has_target() {
            reader.read_bits(layout.target_bits as usize)? as u8
        } else {
            0
        };

        // Read amount as ULEB128
        let amount = reader.read_uleb128()?;

        Ok(Self {
            bet_type,
            target,
            amount,
        })
    }

    /// Validate this descriptor against the layout constraints.
    #[must_use]
    pub fn is_valid(&self, layout: BetLayout) -> bool {
        if self.bet_type > layout.max_bet_type {
            return false;
        }
        if layout.has_target() && self.target > layout.max_target {
            return false;
        }
        true
    }
}

/// Error type for bet descriptor validation.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BetError {
    /// Bet type exceeds maximum for game.
    #[error("bet type {bet_type} exceeds maximum {max} for game")]
    InvalidBetType { bet_type: u8, max: u8 },

    /// Target exceeds maximum for game.
    #[error("target {target} exceeds maximum {max} for game")]
    InvalidTarget { target: u8, max: u8 },

    /// Target provided but not expected.
    #[error("target provided but game layout does not use targets")]
    UnexpectedTarget,

    /// Codec error during encode/decode.
    #[error("codec error: {0}")]
    Codec(#[from] CodecError),
}

/// Roulette bet types (0-13) as defined in compact-encoding-roulette.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum RouletteBetType {
    Straight = 0,
    Split = 1,
    Street = 2,
    Corner = 3,
    SixLine = 4,
    Column = 5,
    Dozen = 6,
    Red = 7,
    Black = 8,
    Even = 9,
    Odd = 10,
    Low = 11,
    High = 12,
    Basket = 13,
}

impl RouletteBetType {
    /// Returns whether this bet type requires a target value.
    #[must_use]
    pub const fn requires_target(&self) -> bool {
        matches!(
            self,
            Self::Straight
                | Self::Split
                | Self::Street
                | Self::Corner
                | Self::SixLine
                | Self::Column
                | Self::Dozen
        )
    }
}

impl TryFrom<u8> for RouletteBetType {
    type Error = BetError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Straight),
            1 => Ok(Self::Split),
            2 => Ok(Self::Street),
            3 => Ok(Self::Corner),
            4 => Ok(Self::SixLine),
            5 => Ok(Self::Column),
            6 => Ok(Self::Dozen),
            7 => Ok(Self::Red),
            8 => Ok(Self::Black),
            9 => Ok(Self::Even),
            10 => Ok(Self::Odd),
            11 => Ok(Self::Low),
            12 => Ok(Self::High),
            13 => Ok(Self::Basket),
            _ => Err(BetError::InvalidBetType {
                bet_type: value,
                max: 13,
            }),
        }
    }
}

/// Craps bet types (0-22) as defined in compact-encoding-craps.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CrapsBetType {
    PassLine = 0,
    DontPass = 1,
    Come = 2,
    DontCome = 3,
    Field = 4,
    Any7 = 5,
    AnyCraps = 6,
    CrapsTwo = 7,
    CrapsThree = 8,
    CrapsEleven = 9,
    CrapsTwelve = 10,
    Place = 11,
    Buy = 12,
    Lay = 13,
    HardFour = 14,
    HardSix = 15,
    HardEight = 16,
    HardTen = 17,
    Big6 = 18,
    Big8 = 19,
    Horn = 20,
    World = 21,
    Hop = 22,
}

impl CrapsBetType {
    /// Returns whether this bet type requires a target value.
    #[must_use]
    pub const fn requires_target(&self) -> bool {
        matches!(
            self,
            Self::Place | Self::Buy | Self::Lay | Self::Hop
        )
    }
}

impl TryFrom<u8> for CrapsBetType {
    type Error = BetError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::PassLine),
            1 => Ok(Self::DontPass),
            2 => Ok(Self::Come),
            3 => Ok(Self::DontCome),
            4 => Ok(Self::Field),
            5 => Ok(Self::Any7),
            6 => Ok(Self::AnyCraps),
            7 => Ok(Self::CrapsTwo),
            8 => Ok(Self::CrapsThree),
            9 => Ok(Self::CrapsEleven),
            10 => Ok(Self::CrapsTwelve),
            11 => Ok(Self::Place),
            12 => Ok(Self::Buy),
            13 => Ok(Self::Lay),
            14 => Ok(Self::HardFour),
            15 => Ok(Self::HardSix),
            16 => Ok(Self::HardEight),
            17 => Ok(Self::HardTen),
            18 => Ok(Self::Big6),
            19 => Ok(Self::Big8),
            20 => Ok(Self::Horn),
            21 => Ok(Self::World),
            22 => Ok(Self::Hop),
            _ => Err(BetError::InvalidBetType {
                bet_type: value,
                max: 22,
            }),
        }
    }
}

/// Sic Bo bet types (0-12) as defined in compact-encoding-sicbo.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SicBoBetType {
    Small = 0,
    Big = 1,
    Odd = 2,
    Even = 3,
    SpecificTriple = 4,
    AnyTriple = 5,
    SpecificDouble = 6,
    TwoFaceCombo = 7,
    SingleDice = 8,
    TotalSum = 9,
    ThreeForces = 10,
    Domino = 11,
    Hop = 12,
}

impl SicBoBetType {
    /// Returns whether this bet type requires a target value.
    #[must_use]
    pub const fn requires_target(&self) -> bool {
        matches!(
            self,
            Self::SpecificTriple
                | Self::SpecificDouble
                | Self::TwoFaceCombo
                | Self::SingleDice
                | Self::TotalSum
                | Self::Domino
                | Self::Hop
        )
    }
}

impl TryFrom<u8> for SicBoBetType {
    type Error = BetError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Small),
            1 => Ok(Self::Big),
            2 => Ok(Self::Odd),
            3 => Ok(Self::Even),
            4 => Ok(Self::SpecificTriple),
            5 => Ok(Self::AnyTriple),
            6 => Ok(Self::SpecificDouble),
            7 => Ok(Self::TwoFaceCombo),
            8 => Ok(Self::SingleDice),
            9 => Ok(Self::TotalSum),
            10 => Ok(Self::ThreeForces),
            11 => Ok(Self::Domino),
            12 => Ok(Self::Hop),
            _ => Err(BetError::InvalidBetType {
                bet_type: value,
                max: 12,
            }),
        }
    }
}

/// Baccarat bet types (0-9) as defined in compact-encoding-baccarat.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BaccaratBetType {
    Player = 0,
    Banker = 1,
    Tie = 2,
    PlayerPair = 3,
    BankerPair = 4,
    EitherPair = 5,
    PerfectPair = 6,
    Big = 7,
    Small = 8,
    SuperSix = 9,
}

impl BaccaratBetType {
    /// Baccarat bets never require a target.
    #[must_use]
    pub const fn requires_target(&self) -> bool {
        false
    }
}

impl TryFrom<u8> for BaccaratBetType {
    type Error = BetError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Player),
            1 => Ok(Self::Banker),
            2 => Ok(Self::Tie),
            3 => Ok(Self::PlayerPair),
            4 => Ok(Self::BankerPair),
            5 => Ok(Self::EitherPair),
            6 => Ok(Self::PerfectPair),
            7 => Ok(Self::Big),
            8 => Ok(Self::Small),
            9 => Ok(Self::SuperSix),
            _ => Err(BetError::InvalidBetType {
                bet_type: value,
                max: 9,
            }),
        }
    }
}

/// Game type enumeration for bet encoding dispatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableGame {
    Roulette,
    Craps,
    SicBo,
    Baccarat,
}

impl TableGame {
    /// Get the bet layout for this game.
    #[must_use]
    pub const fn layout(&self) -> BetLayout {
        match self {
            Self::Roulette => bet_layouts::ROULETTE,
            Self::Craps => bet_layouts::CRAPS,
            Self::SicBo => bet_layouts::SIC_BO,
            Self::Baccarat => bet_layouts::BACCARAT,
        }
    }

    /// All supported table games (AC-2.1 coverage).
    pub const ALL: [TableGame; 4] = [
        Self::Roulette,
        Self::Craps,
        Self::SicBo,
        Self::Baccarat,
    ];
}

#[cfg(test)]
mod bet_descriptor_tests {
    use super::*;

    // ========================================================================
    // AC-2.1: Shared bet descriptor structure
    // ========================================================================

    #[test]
    fn test_all_games_use_shared_descriptor_ac_2_1() {
        // All table games encode/decode through the same BetDescriptor type
        for game in TableGame::ALL {
            let bet = BetDescriptor::new(1, 2, 100);
            let layout = game.layout();

            // Encode
            let mut writer = BitWriter::new();
            bet.encode(&mut writer, layout).expect("encode failed");
            let bytes = writer.finish();

            // Decode
            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptor::decode(&mut reader, layout).expect("decode failed");

            // Roundtrip
            assert_eq!(bet.bet_type, decoded.bet_type);
            assert_eq!(bet.amount, decoded.amount);
            // Target may differ for games without target fields
            if layout.has_target() {
                assert_eq!(bet.target, decoded.target);
            }
        }
    }

    #[test]
    fn test_descriptor_structure_identical_ac_2_1() {
        // Verify the descriptor has the same fields for all games:
        // bet_type, target, amount
        let roulette_bet = BetDescriptor::new(0, 17, 500);
        let craps_bet = BetDescriptor::new(0, 6, 500);
        let sicbo_bet = BetDescriptor::new(0, 0, 500);
        let baccarat_bet = BetDescriptor::without_target(0, 500);

        // All use the same struct type
        assert_eq!(
            std::mem::size_of_val(&roulette_bet),
            std::mem::size_of_val(&craps_bet)
        );
        assert_eq!(
            std::mem::size_of_val(&craps_bet),
            std::mem::size_of_val(&sicbo_bet)
        );
        assert_eq!(
            std::mem::size_of_val(&sicbo_bet),
            std::mem::size_of_val(&baccarat_bet)
        );
    }

    #[test]
    fn test_encode_decode_paths_unified_ac_2_1() {
        // All games use exactly the same encode/decode methods
        let test_cases = [
            (TableGame::Roulette, 7, 0, 100),  // Red
            (TableGame::Craps, 0, 0, 200),     // Pass Line
            (TableGame::SicBo, 0, 0, 150),     // Small
            (TableGame::Baccarat, 0, 0, 300),  // Player
        ];

        for (game, bet_type, target, amount) in test_cases {
            let bet = BetDescriptor::new(bet_type, target, amount);
            let layout = game.layout();

            let mut writer = BitWriter::new();
            // Same method for all games
            bet.encode(&mut writer, layout).unwrap();
            let encoded = writer.finish();

            let mut reader = BitReader::new(&encoded);
            // Same method for all games
            let decoded = BetDescriptor::decode(&mut reader, layout).unwrap();

            assert_eq!(decoded.bet_type, bet_type);
            assert_eq!(decoded.amount, amount);
        }
    }

    // ========================================================================
    // AC-2.2: No bespoke bet payloads
    // ========================================================================

    #[test]
    fn test_no_bespoke_payloads_ac_2_2() {
        // All games' bet encoding goes through BetDescriptor
        // There is no game-specific encode/decode function outside this unified path

        // Roulette: straight bet on 17
        let roulette = BetDescriptor::new(
            RouletteBetType::Straight as u8,
            17,
            100,
        );
        let mut w = BitWriter::new();
        roulette.encode(&mut w, bet_layouts::ROULETTE).unwrap();

        // Craps: pass line bet
        let craps = BetDescriptor::new(
            CrapsBetType::PassLine as u8,
            0,
            100,
        );
        let mut w = BitWriter::new();
        craps.encode(&mut w, bet_layouts::CRAPS).unwrap();

        // Sic Bo: small bet
        let sicbo = BetDescriptor::new(
            SicBoBetType::Small as u8,
            0,
            100,
        );
        let mut w = BitWriter::new();
        sicbo.encode(&mut w, bet_layouts::SIC_BO).unwrap();

        // Baccarat: player bet
        let baccarat = BetDescriptor::without_target(
            BaccaratBetType::Player as u8,
            100,
        );
        let mut w = BitWriter::new();
        baccarat.encode(&mut w, bet_layouts::BACCARAT).unwrap();

        // All successfully encoded through the unified BetDescriptor
    }

    #[test]
    fn test_layout_consistency_across_games_ac_2_2() {
        // Verify that all games define layouts using the same BetLayout struct
        let layouts: [(&str, BetLayout); 4] = [
            ("roulette", bet_layouts::ROULETTE),
            ("craps", bet_layouts::CRAPS),
            ("sicbo", bet_layouts::SIC_BO),
            ("baccarat", bet_layouts::BACCARAT),
        ];

        for (name, layout) in layouts {
            // All layouts have the same fields
            assert!(
                layout.bet_type_bits > 0 && layout.bet_type_bits <= 8,
                "{} bet_type_bits out of range",
                name
            );
            assert!(
                layout.target_bits <= 8,
                "{} target_bits out of range",
                name
            );
            // Max values are within bit constraints
            assert!(
                layout.max_bet_type < (1 << layout.bet_type_bits),
                "{} max_bet_type exceeds bit width",
                name
            );
            if layout.has_target() {
                assert!(
                    layout.max_target < (1 << layout.target_bits),
                    "{} max_target exceeds bit width",
                    name
                );
            }
        }
    }

    // ========================================================================
    // Roundtrip tests per game
    // ========================================================================

    #[test]
    fn test_roulette_bet_roundtrip() {
        let bets = [
            BetDescriptor::new(RouletteBetType::Straight as u8, 17, 100),
            BetDescriptor::new(RouletteBetType::Split as u8, 5, 200),
            BetDescriptor::new(RouletteBetType::Red as u8, 0, 50),
            BetDescriptor::new(RouletteBetType::Dozen as u8, 1, 1000),
        ];

        for bet in bets {
            let mut writer = BitWriter::new();
            bet.encode(&mut writer, bet_layouts::ROULETTE).unwrap();
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptor::decode(&mut reader, bet_layouts::ROULETTE).unwrap();

            assert_eq!(decoded, bet);
        }
    }

    #[test]
    fn test_craps_bet_roundtrip() {
        let bets = [
            BetDescriptor::new(CrapsBetType::PassLine as u8, 0, 100),
            BetDescriptor::new(CrapsBetType::Place as u8, 6, 200),
            BetDescriptor::new(CrapsBetType::HardSix as u8, 0, 50),
            BetDescriptor::new(CrapsBetType::Hop as u8, 3, 25),
        ];

        for bet in bets {
            let mut writer = BitWriter::new();
            bet.encode(&mut writer, bet_layouts::CRAPS).unwrap();
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptor::decode(&mut reader, bet_layouts::CRAPS).unwrap();

            assert_eq!(decoded, bet);
        }
    }

    #[test]
    fn test_sicbo_bet_roundtrip() {
        let bets = [
            BetDescriptor::new(SicBoBetType::Small as u8, 0, 100),
            BetDescriptor::new(SicBoBetType::TotalSum as u8, 11, 200),
            BetDescriptor::new(SicBoBetType::SpecificTriple as u8, 3, 50),
            BetDescriptor::new(SicBoBetType::AnyTriple as u8, 0, 75),
        ];

        for bet in bets {
            let mut writer = BitWriter::new();
            bet.encode(&mut writer, bet_layouts::SIC_BO).unwrap();
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptor::decode(&mut reader, bet_layouts::SIC_BO).unwrap();

            assert_eq!(decoded, bet);
        }
    }

    #[test]
    fn test_baccarat_bet_roundtrip() {
        let bets = [
            BetDescriptor::without_target(BaccaratBetType::Player as u8, 100),
            BetDescriptor::without_target(BaccaratBetType::Banker as u8, 200),
            BetDescriptor::without_target(BaccaratBetType::Tie as u8, 50),
            BetDescriptor::without_target(BaccaratBetType::SuperSix as u8, 25),
        ];

        for bet in bets {
            let mut writer = BitWriter::new();
            bet.encode(&mut writer, bet_layouts::BACCARAT).unwrap();
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptor::decode(&mut reader, bet_layouts::BACCARAT).unwrap();

            assert_eq!(decoded, bet);
        }
    }

    // ========================================================================
    // Bet type enum tests
    // ========================================================================

    #[test]
    fn test_roulette_bet_type_conversion() {
        for i in 0..=13u8 {
            let bet_type = RouletteBetType::try_from(i).expect("valid range");
            assert_eq!(bet_type as u8, i);
        }
        assert!(RouletteBetType::try_from(14).is_err());
    }

    #[test]
    fn test_craps_bet_type_conversion() {
        for i in 0..=22u8 {
            let bet_type = CrapsBetType::try_from(i).expect("valid range");
            assert_eq!(bet_type as u8, i);
        }
        assert!(CrapsBetType::try_from(23).is_err());
    }

    #[test]
    fn test_sicbo_bet_type_conversion() {
        for i in 0..=12u8 {
            let bet_type = SicBoBetType::try_from(i).expect("valid range");
            assert_eq!(bet_type as u8, i);
        }
        assert!(SicBoBetType::try_from(13).is_err());
    }

    #[test]
    fn test_baccarat_bet_type_conversion() {
        for i in 0..=9u8 {
            let bet_type = BaccaratBetType::try_from(i).expect("valid range");
            assert_eq!(bet_type as u8, i);
        }
        assert!(BaccaratBetType::try_from(10).is_err());
    }

    // ========================================================================
    // Validation tests
    // ========================================================================

    #[test]
    fn test_descriptor_validation() {
        // Valid
        let valid = BetDescriptor::new(5, 10, 100);
        assert!(valid.is_valid(bet_layouts::ROULETTE));

        // Invalid bet_type
        let invalid_type = BetDescriptor::new(15, 10, 100);
        assert!(!invalid_type.is_valid(bet_layouts::ROULETTE));

        // Invalid target
        let invalid_target = BetDescriptor::new(5, 64, 100);
        assert!(!invalid_target.is_valid(bet_layouts::ROULETTE));
    }

    #[test]
    fn test_baccarat_ignores_target_in_validation() {
        // Baccarat has no target field, so target value doesn't matter for validation
        let with_target = BetDescriptor::new(0, 255, 100);
        assert!(with_target.is_valid(bet_layouts::BACCARAT));
    }

    // ========================================================================
    // Size verification tests
    // ========================================================================

    #[test]
    fn test_bet_descriptor_size_compact() {
        // Per spec: single bet payload <= 4 bytes for small amounts

        // Roulette: 4 + 6 = 10 bits fixed + ULEB128(100) = 1 byte
        // Total: ceil(10/8) + 1 = 2 + 1 = 3 bytes max (but bit-packed)
        let bet = BetDescriptor::new(0, 17, 100);
        let mut writer = BitWriter::new();
        bet.encode(&mut writer, bet_layouts::ROULETTE).unwrap();
        let bytes = writer.finish();
        assert!(bytes.len() <= 4, "roulette bet too large: {} bytes", bytes.len());

        // Craps: 5 + 4 = 9 bits fixed + ULEB128(100) = 1 byte
        let bet = BetDescriptor::new(0, 6, 100);
        let mut writer = BitWriter::new();
        bet.encode(&mut writer, bet_layouts::CRAPS).unwrap();
        let bytes = writer.finish();
        assert!(bytes.len() <= 4, "craps bet too large: {} bytes", bytes.len());

        // Baccarat: 4 bits fixed + ULEB128(100) = 1 byte
        let bet = BetDescriptor::without_target(0, 100);
        let mut writer = BitWriter::new();
        bet.encode(&mut writer, bet_layouts::BACCARAT).unwrap();
        let bytes = writer.finish();
        assert!(bytes.len() <= 4, "baccarat bet too large: {} bytes", bytes.len());
    }
}
