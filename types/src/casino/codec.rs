use bytes::{Buf, BufMut};
use commonware_codec::{Error, ReadExt, Write};

// ============================================================================
// Compact v2 Encoding Framework
// ============================================================================
//
// This module provides bitwise-compact encoding for casino game payloads.
// Key design principles:
// - Common envelope: 3-bit version + 5-bit opcode in 1 byte
// - ULEB128 for variable-length amounts (typical bets fit 1-2 bytes)
// - Game-specific bet descriptors with conditional target fields
//
// Protocol version support:
// - v1: Current byte-aligned format (supported for backward compatibility)
// - v2: Bitwise-compact format (new, ~40% smaller)

/// Protocol version for compact v2 encoding.
pub const V2_PROTOCOL_VERSION: u8 = 2;

/// Maximum bits for version field (3 bits = 0-7).
pub const VERSION_BITS: u8 = 3;

/// Maximum bits for opcode field (5 bits = 0-31).
pub const OPCODE_BITS: u8 = 5;

// ============================================================================
// BitWriter - Bitwise encoding
// ============================================================================

/// Bitwise writer for compact encoding.
///
/// Writes bits LSB-first within each byte, bytes in order.
/// Example: writing 5 bits (0b10110) produces byte 0b00010110.
#[derive(Debug, Clone)]
pub struct BitWriter {
    buffer: Vec<u8>,
    bit_offset: u8, // 0-7, position within current partial byte
    current_byte: u8,
}

impl BitWriter {
    /// Create a new BitWriter with default capacity.
    pub fn new() -> Self {
        Self::with_capacity(16)
    }

    /// Create a new BitWriter with specified capacity in bytes.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(capacity),
            bit_offset: 0,
            current_byte: 0,
        }
    }

    /// Write `count` bits from the LSB of `value`.
    ///
    /// # Panics
    /// Panics if `count > 8`.
    pub fn write_bits(&mut self, value: u8, count: u8) {
        debug_assert!(count <= 8, "count must be <= 8");
        if count == 0 {
            return;
        }

        // Mask to keep only `count` LSBs
        let mask = (1u16 << count) - 1;
        let masked = (value as u16) & mask;

        // Combine with current partial byte
        let combined = (self.current_byte as u16) | (masked << self.bit_offset);

        let total_bits = self.bit_offset + count;
        if total_bits >= 8 {
            // Flush the full byte
            self.buffer.push(combined as u8);
            self.current_byte = (combined >> 8) as u8;
            self.bit_offset = total_bits - 8;
        } else {
            self.current_byte = combined as u8;
            self.bit_offset = total_bits;
        }
    }

    /// Write a full byte (8 bits).
    pub fn write_byte(&mut self, value: u8) {
        self.write_bits(value, 8);
    }

    /// Write a u16 value as 16 bits (little-endian bit order).
    pub fn write_u16(&mut self, value: u16) {
        self.write_bits(value as u8, 8);
        self.write_bits((value >> 8) as u8, 8);
    }

    /// Write a u32 value as 32 bits (little-endian bit order).
    pub fn write_u32(&mut self, value: u32) {
        self.write_bits(value as u8, 8);
        self.write_bits((value >> 8) as u8, 8);
        self.write_bits((value >> 16) as u8, 8);
        self.write_bits((value >> 24) as u8, 8);
    }

    /// Write a u64 value using ULEB128 encoding.
    ///
    /// ULEB128 uses 7 bits per byte, with the MSB as continuation flag.
    /// Most casino bet amounts (< 128) fit in 1 byte.
    pub fn write_uleb128(&mut self, mut value: u64) {
        loop {
            let mut byte = (value & 0x7F) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80; // Set continuation bit
            }
            self.write_byte(byte);
            if value == 0 {
                break;
            }
        }
    }

    /// Write the v2 envelope header: 3-bit version + 5-bit opcode.
    pub fn write_envelope(&mut self, opcode: u8) {
        debug_assert!(opcode < 32, "opcode must fit in 5 bits");
        let header = (V2_PROTOCOL_VERSION & 0x07) | ((opcode & 0x1F) << 3);
        self.write_byte(header);
    }

    /// Finalize and return the encoded bytes.
    ///
    /// Flushes any partial byte with zero padding.
    pub fn finish(mut self) -> Vec<u8> {
        if self.bit_offset > 0 {
            self.buffer.push(self.current_byte);
        }
        self.buffer
    }

    /// Get the current length in bytes (including partial byte).
    pub fn len(&self) -> usize {
        self.buffer.len() + if self.bit_offset > 0 { 1 } else { 0 }
    }

    /// Check if the writer is empty.
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty() && self.bit_offset == 0
    }
}

impl Default for BitWriter {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// BitReader - Bitwise decoding
// ============================================================================

/// Bitwise reader for compact decoding.
///
/// Reads bits LSB-first within each byte, matching BitWriter.
#[derive(Debug, Clone)]
pub struct BitReader<'a> {
    data: &'a [u8],
    byte_offset: usize,
    bit_offset: u8, // 0-7, position within current byte
}

impl<'a> BitReader<'a> {
    /// Create a new BitReader from a byte slice.
    pub fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            byte_offset: 0,
            bit_offset: 0,
        }
    }

    /// Read `count` bits, returning them in the LSB of the result.
    ///
    /// Returns `None` if not enough bits are available.
    pub fn read_bits(&mut self, count: u8) -> Option<u8> {
        debug_assert!(count <= 8, "count must be <= 8");
        if count == 0 {
            return Some(0);
        }

        // Check if we have enough bits
        let total_bits = self.byte_offset * 8 + self.bit_offset as usize + count as usize;
        if total_bits > self.data.len() * 8 {
            return None;
        }

        let mut result: u16 = 0;
        let mut bits_read: u8 = 0;
        let mut current_bit_offset = self.bit_offset;
        let mut current_byte_offset = self.byte_offset;

        while bits_read < count {
            if current_byte_offset >= self.data.len() {
                return None;
            }

            let byte = self.data[current_byte_offset];
            let bits_available = 8 - current_bit_offset;
            let bits_needed = count - bits_read;
            let bits_to_take = bits_available.min(bits_needed);

            // Extract bits from current byte
            let mask = ((1u16 << bits_to_take) - 1) as u8;
            let extracted = (byte >> current_bit_offset) & mask;
            result |= (extracted as u16) << bits_read;

            bits_read += bits_to_take;
            current_bit_offset += bits_to_take;

            if current_bit_offset >= 8 {
                current_bit_offset = 0;
                current_byte_offset += 1;
            }
        }

        self.bit_offset = current_bit_offset;
        self.byte_offset = current_byte_offset;

        Some(result as u8)
    }

    /// Read a full byte (8 bits).
    pub fn read_byte(&mut self) -> Option<u8> {
        self.read_bits(8)
    }

    /// Read a u16 value (16 bits, little-endian).
    pub fn read_u16(&mut self) -> Option<u16> {
        let lo = self.read_byte()? as u16;
        let hi = self.read_byte()? as u16;
        Some(lo | (hi << 8))
    }

    /// Read a u32 value (32 bits, little-endian).
    pub fn read_u32(&mut self) -> Option<u32> {
        let b0 = self.read_byte()? as u32;
        let b1 = self.read_byte()? as u32;
        let b2 = self.read_byte()? as u32;
        let b3 = self.read_byte()? as u32;
        Some(b0 | (b1 << 8) | (b2 << 16) | (b3 << 24))
    }

    /// Read a u64 value using ULEB128 decoding.
    ///
    /// Returns `None` if the encoding is invalid or incomplete.
    pub fn read_uleb128(&mut self) -> Option<u64> {
        let mut result: u64 = 0;
        let mut shift: u32 = 0;

        loop {
            let byte = self.read_byte()?;
            let value = (byte & 0x7F) as u64;

            // Check for overflow
            if shift >= 64 || (shift == 63 && value > 1) {
                return None;
            }

            result |= value << shift;

            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
        }

        Some(result)
    }

    /// Read the v2 envelope header, returning (version, opcode).
    ///
    /// Returns `None` if not enough data or invalid version.
    pub fn read_envelope(&mut self) -> Option<(u8, u8)> {
        let header = self.read_byte()?;
        let version = header & 0x07;
        let opcode = (header >> 3) & 0x1F;

        if version != V2_PROTOCOL_VERSION {
            return None;
        }

        Some((version, opcode))
    }

    /// Check if version byte indicates v2 encoding.
    ///
    /// Does not consume any bits.
    pub fn is_v2(&self) -> bool {
        if self.data.is_empty() {
            return false;
        }
        (self.data[0] & 0x07) == V2_PROTOCOL_VERSION
    }

    /// Get remaining bytes (byte-aligned).
    pub fn remaining_bytes(&self) -> usize {
        if self.byte_offset >= self.data.len() {
            0
        } else if self.bit_offset == 0 {
            self.data.len() - self.byte_offset
        } else {
            self.data.len() - self.byte_offset - 1
        }
    }

    /// Check if the reader has been exhausted.
    pub fn is_empty(&self) -> bool {
        self.byte_offset >= self.data.len()
            || (self.byte_offset == self.data.len() - 1 && self.bit_offset >= 8)
    }
}

// ============================================================================
// V2 Bet Descriptor Encoding/Decoding
// ============================================================================

/// Unified bet descriptor for table games (v2 format).
///
/// Structure varies by game:
/// - Roulette: bet_type (4 bits) + value (6 bits) + amount (ULEB128)
/// - Sic Bo: bet_type (4 bits) + target (6 bits, conditional) + amount (ULEB128)
/// - Baccarat: bet_type (4 bits) + amount (ULEB128)
/// - Craps: bet_type (5 bits) + target (4 bits, conditional) + amount (ULEB128)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BetDescriptorV2 {
    pub bet_type: u8,
    pub target: Option<u8>,
    pub amount: u64,
}

impl BetDescriptorV2 {
    /// Create a new bet descriptor.
    pub fn new(bet_type: u8, target: Option<u8>, amount: u64) -> Self {
        Self {
            bet_type,
            target,
            amount,
        }
    }

    /// Encode for roulette (4-bit type + 6-bit value + ULEB128 amount).
    pub fn encode_roulette(&self, writer: &mut BitWriter) {
        writer.write_bits(self.bet_type, 4);
        writer.write_bits(self.target.unwrap_or(0), 6);
        writer.write_uleb128(self.amount);
    }

    /// Decode for roulette.
    pub fn decode_roulette(reader: &mut BitReader) -> Option<Self> {
        let bet_type = reader.read_bits(4)?;
        let value = reader.read_bits(6)?;
        let amount = reader.read_uleb128()?;
        Some(Self {
            bet_type,
            target: Some(value),
            amount,
        })
    }

    /// Encode for sic bo (4-bit type + optional 6-bit target + ULEB128 amount).
    ///
    /// Target is included for bet types that require it (SpecificTriple, SpecificDouble, etc).
    pub fn encode_sic_bo(&self, writer: &mut BitWriter, needs_target: bool) {
        writer.write_bits(self.bet_type, 4);
        if needs_target {
            writer.write_bits(self.target.unwrap_or(0), 6);
        }
        writer.write_uleb128(self.amount);
    }

    /// Decode for sic bo.
    pub fn decode_sic_bo(reader: &mut BitReader, needs_target: bool) -> Option<Self> {
        let bet_type = reader.read_bits(4)?;
        let target = if needs_target {
            Some(reader.read_bits(6)?)
        } else {
            None
        };
        let amount = reader.read_uleb128()?;
        Some(Self {
            bet_type,
            target,
            amount,
        })
    }

    /// Encode for baccarat (4-bit type + ULEB128 amount, no target).
    pub fn encode_baccarat(&self, writer: &mut BitWriter) {
        writer.write_bits(self.bet_type, 4);
        writer.write_uleb128(self.amount);
    }

    /// Decode for baccarat.
    pub fn decode_baccarat(reader: &mut BitReader) -> Option<Self> {
        let bet_type = reader.read_bits(4)?;
        let amount = reader.read_uleb128()?;
        Some(Self {
            bet_type,
            target: None,
            amount,
        })
    }

    /// Encode for craps (5-bit type + optional 4-bit target + ULEB128 amount).
    pub fn encode_craps(&self, writer: &mut BitWriter, needs_target: bool) {
        writer.write_bits(self.bet_type, 5);
        if needs_target {
            writer.write_bits(self.target.unwrap_or(0), 4);
        }
        writer.write_uleb128(self.amount);
    }

    /// Decode for craps.
    pub fn decode_craps(reader: &mut BitReader, needs_target: bool) -> Option<Self> {
        let bet_type = reader.read_bits(5)?;
        let target = if needs_target {
            Some(reader.read_bits(4)?)
        } else {
            None
        };
        let amount = reader.read_uleb128()?;
        Some(Self {
            bet_type,
            target,
            amount,
        })
    }
}

// ============================================================================
// Legacy String Encoding (kept for compatibility)
// ============================================================================

/// Helper to write a string as length-prefixed UTF-8 bytes.
pub fn write_string(s: &str, writer: &mut impl BufMut) {
    let bytes = s.as_bytes();
    (bytes.len() as u32).write(writer);
    writer.put_slice(bytes);
}

/// Helper to read a string from length-prefixed UTF-8 bytes.
pub fn read_string(reader: &mut impl Buf, max_len: usize) -> Result<String, Error> {
    let len = u32::read(reader)? as usize;
    if len > max_len {
        return Err(Error::Invalid("String", "too long"));
    }
    if reader.remaining() < len {
        return Err(Error::EndOfBuffer);
    }
    if reader.chunk().len() >= len {
        let result = {
            let chunk = reader.chunk();
            match std::str::from_utf8(&chunk[..len]) {
                Ok(s) => Ok(s.to_owned()),
                Err(_) => Err(Error::Invalid("String", "invalid UTF-8")),
            }
        };
        reader.advance(len);
        return result;
    }
    let mut bytes = vec![0u8; len];
    reader.copy_to_slice(&mut bytes);
    String::from_utf8(bytes).map_err(|_| Error::Invalid("String", "invalid UTF-8"))
}

/// Helper to get encode size of a string.
pub fn string_encode_size(s: &str) -> usize {
    4 + s.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;
    use rand::{rngs::StdRng, Rng, RngCore, SeedableRng};

    // ========================================================================
    // BitWriter / BitReader Tests
    // ========================================================================

    #[test]
    fn bitwriter_write_bits_basic() {
        let mut writer = BitWriter::new();

        // Write 4 bits (0b1010 = 10)
        writer.write_bits(0b1010, 4);
        // Write 4 bits (0b0101 = 5)
        writer.write_bits(0b0101, 4);

        let bytes = writer.finish();
        // LSB-first: 0b1010 in low 4 bits, 0b0101 in high 4 bits = 0b01011010 = 0x5A
        assert_eq!(bytes, vec![0x5A]);
    }

    #[test]
    fn bitwriter_write_bits_cross_byte() {
        let mut writer = BitWriter::new();

        // Write 5 bits (0b10110 = 22)
        writer.write_bits(0b10110, 5);
        // Write 5 bits (0b01001 = 9)
        writer.write_bits(0b01001, 5);

        let bytes = writer.finish();
        // First byte: 0b10110 + 3 bits of 0b01001 (= 001) = 0b00110110 = 0x36
        // Second byte: remaining 2 bits of 0b01001 (= 01) = 0b00000001 = 0x01
        assert_eq!(bytes, vec![0x36, 0x01]);
    }

    #[test]
    fn bitwriter_write_byte() {
        let mut writer = BitWriter::new();
        writer.write_byte(0xAB);
        writer.write_byte(0xCD);
        assert_eq!(writer.finish(), vec![0xAB, 0xCD]);
    }

    #[test]
    fn bitwriter_write_uleb128_small() {
        let mut writer = BitWriter::new();
        writer.write_uleb128(100);
        let bytes = writer.finish();
        // 100 fits in 7 bits, so 1 byte
        assert_eq!(bytes, vec![100]);
    }

    #[test]
    fn bitwriter_write_uleb128_medium() {
        let mut writer = BitWriter::new();
        writer.write_uleb128(300);
        let bytes = writer.finish();
        // 300 = 0b100101100 = 9 bits
        // ULEB128: [0b10101100, 0b00000010] = [0xAC, 0x02]
        assert_eq!(bytes, vec![0xAC, 0x02]);
    }

    #[test]
    fn bitwriter_write_uleb128_large() {
        let mut writer = BitWriter::new();
        writer.write_uleb128(1_000_000);
        let bytes = writer.finish();
        // 1_000_000 = 0xF4240
        // ULEB128: [0xC0, 0x84, 0x3D]
        assert_eq!(bytes, vec![0xC0, 0x84, 0x3D]);
    }

    #[test]
    fn bitwriter_write_envelope() {
        let mut writer = BitWriter::new();
        writer.write_envelope(4); // opcode 4 = AtomicBatch for roulette

        let bytes = writer.finish();
        // version=2 (3 bits) + opcode=4 (5 bits) = 0b00100_010 = 0x22
        assert_eq!(bytes, vec![0x22]);
    }

    #[test]
    fn bitreader_read_bits_basic() {
        // 0x5A = 0b01011010
        let data = vec![0x5A];
        let mut reader = BitReader::new(&data);

        // Read low 4 bits: 0b1010 = 10
        assert_eq!(reader.read_bits(4), Some(10));
        // Read high 4 bits: 0b0101 = 5
        assert_eq!(reader.read_bits(4), Some(5));
    }

    #[test]
    fn bitreader_read_bits_cross_byte() {
        let data = vec![0x36, 0x01];
        let mut reader = BitReader::new(&data);

        // Read 5 bits: 0b10110 = 22
        assert_eq!(reader.read_bits(5), Some(22));
        // Read 5 bits: 0b01001 = 9
        assert_eq!(reader.read_bits(5), Some(9));
    }

    #[test]
    fn bitreader_read_uleb128_small() {
        let data = vec![100];
        let mut reader = BitReader::new(&data);
        assert_eq!(reader.read_uleb128(), Some(100));
    }

    #[test]
    fn bitreader_read_uleb128_medium() {
        let data = vec![0xAC, 0x02];
        let mut reader = BitReader::new(&data);
        assert_eq!(reader.read_uleb128(), Some(300));
    }

    #[test]
    fn bitreader_read_uleb128_large() {
        let data = vec![0xC0, 0x84, 0x3D];
        let mut reader = BitReader::new(&data);
        assert_eq!(reader.read_uleb128(), Some(1_000_000));
    }

    #[test]
    fn bitreader_read_envelope() {
        let data = vec![0x22]; // version=2, opcode=4
        let mut reader = BitReader::new(&data);
        assert_eq!(reader.read_envelope(), Some((2, 4)));
    }

    #[test]
    fn bitreader_read_envelope_wrong_version() {
        let data = vec![0x21]; // version=1, opcode=4
        let mut reader = BitReader::new(&data);
        assert_eq!(reader.read_envelope(), None);
    }

    #[test]
    fn bitreader_is_v2() {
        assert!(BitReader::new(&[0x02]).is_v2()); // version=2
        assert!(BitReader::new(&[0x22]).is_v2()); // version=2, opcode=4
        assert!(!BitReader::new(&[0x01]).is_v2()); // version=1
        assert!(!BitReader::new(&[]).is_v2()); // empty
    }

    #[test]
    fn bit_roundtrip_random() {
        let mut rng = StdRng::seed_from_u64(0xc0dec);

        for _ in 0..1000 {
            let mut writer = BitWriter::new();
            let num_values = rng.gen_range(1..=20);
            let mut expected: Vec<(u8, u8)> = Vec::with_capacity(num_values);

            for _ in 0..num_values {
                let bits = rng.gen_range(1..=8);
                let max_val = (1u16 << bits) - 1;
                let value = rng.gen_range(0..=max_val) as u8;
                writer.write_bits(value, bits);
                // Use u16 to avoid overflow when bits==8
                let mask = ((1u16 << bits) - 1) as u8;
                expected.push((value & mask, bits));
            }

            let bytes = writer.finish();
            let mut reader = BitReader::new(&bytes);

            for (exp_val, bits) in expected {
                let read_val = reader.read_bits(bits).expect("should read bits");
                assert_eq!(read_val, exp_val, "bits={}", bits);
            }
        }
    }

    #[test]
    fn uleb128_roundtrip_random() {
        let mut rng = StdRng::seed_from_u64(0xdead);

        for _ in 0..1000 {
            let mut writer = BitWriter::new();
            let value: u64 = rng.gen();
            writer.write_uleb128(value);

            let bytes = writer.finish();
            let mut reader = BitReader::new(&bytes);
            assert_eq!(reader.read_uleb128(), Some(value));
        }
    }

    // ========================================================================
    // BetDescriptorV2 Tests
    // ========================================================================

    #[test]
    fn bet_descriptor_roulette_roundtrip() {
        let bet = BetDescriptorV2::new(1, Some(0), 100); // Red bet, 100 chips

        let mut writer = BitWriter::new();
        bet.encode_roulette(&mut writer);
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        let decoded = BetDescriptorV2::decode_roulette(&mut reader).expect("decode");

        assert_eq!(decoded.bet_type, 1);
        assert_eq!(decoded.target, Some(0));
        assert_eq!(decoded.amount, 100);
    }

    #[test]
    fn bet_descriptor_roulette_size_comparison() {
        // v1: 10 bytes per bet (type + number + 8-byte amount)
        // v2: ~2-3 bytes per bet (4-bit type + 6-bit value + 1-byte ULEB128 for amount < 128)

        let bet = BetDescriptorV2::new(0, Some(17), 100); // Straight on 17, 100 chips

        let mut writer = BitWriter::new();
        bet.encode_roulette(&mut writer);
        let bytes = writer.finish();

        // 4 bits + 6 bits + 1 byte = 10 bits + 8 bits = 18 bits = 3 bytes (with padding)
        // Actually: 4+6=10 bits in first 2 bytes partial, then 1 byte ULEB128 = 2 bytes total
        assert!(bytes.len() <= 3, "v2 bet should be <= 3 bytes, got {}", bytes.len());
    }

    #[test]
    fn bet_descriptor_sic_bo_with_target() {
        let bet = BetDescriptorV2::new(4, Some(3), 50); // SpecificTriple on 3

        let mut writer = BitWriter::new();
        bet.encode_sic_bo(&mut writer, true);
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        let decoded = BetDescriptorV2::decode_sic_bo(&mut reader, true).expect("decode");

        assert_eq!(decoded.bet_type, 4);
        assert_eq!(decoded.target, Some(3));
        assert_eq!(decoded.amount, 50);
    }

    #[test]
    fn bet_descriptor_sic_bo_without_target() {
        let bet = BetDescriptorV2::new(0, None, 100); // Small bet

        let mut writer = BitWriter::new();
        bet.encode_sic_bo(&mut writer, false);
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        let decoded = BetDescriptorV2::decode_sic_bo(&mut reader, false).expect("decode");

        assert_eq!(decoded.bet_type, 0);
        assert_eq!(decoded.target, None);
        assert_eq!(decoded.amount, 100);
    }

    #[test]
    fn bet_descriptor_baccarat_roundtrip() {
        let bet = BetDescriptorV2::new(0, None, 500); // Player bet

        let mut writer = BitWriter::new();
        bet.encode_baccarat(&mut writer);
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        let decoded = BetDescriptorV2::decode_baccarat(&mut reader).expect("decode");

        assert_eq!(decoded.bet_type, 0);
        assert_eq!(decoded.target, None);
        assert_eq!(decoded.amount, 500);
    }

    #[test]
    fn bet_descriptor_craps_with_target() {
        let bet = BetDescriptorV2::new(5, Some(6), 25); // Yes bet on 6

        let mut writer = BitWriter::new();
        bet.encode_craps(&mut writer, true);
        let bytes = writer.finish();

        let mut reader = BitReader::new(&bytes);
        let decoded = BetDescriptorV2::decode_craps(&mut reader, true).expect("decode");

        assert_eq!(decoded.bet_type, 5);
        assert_eq!(decoded.target, Some(6));
        assert_eq!(decoded.amount, 25);
    }

    // ========================================================================
    // Size Reduction Validation
    // ========================================================================

    #[test]
    fn v2_atomic_batch_size_reduction() {
        // v1 roulette atomic batch: 2 bytes header + 10 bytes per bet
        // v2 roulette atomic batch: 1 byte envelope + 5 bits bet_count + (10 bits + ULEB128) per bet

        // Simulate 5 bets with small amounts
        let bets = vec![
            BetDescriptorV2::new(1, Some(0), 100),  // Red, 100
            BetDescriptorV2::new(2, Some(0), 50),   // Black, 50
            BetDescriptorV2::new(7, Some(1), 25),   // Dozen 2, 25
            BetDescriptorV2::new(0, Some(17), 10),  // Straight 17, 10
            BetDescriptorV2::new(5, Some(0), 75),   // Low, 75
        ];

        // v1 size: 2 + 5*10 = 52 bytes
        let v1_size = 2 + bets.len() * 10;

        // v2 size: encode and measure
        let mut writer = BitWriter::new();
        writer.write_envelope(4); // AtomicBatch opcode
        writer.write_bits(bets.len() as u8, 5);
        for bet in &bets {
            bet.encode_roulette(&mut writer);
        }
        let v2_bytes = writer.finish();
        let v2_size = v2_bytes.len();

        // v2 should be at least 30% smaller
        let reduction = (v1_size - v2_size) as f64 / v1_size as f64;
        assert!(
            reduction >= 0.30,
            "Expected >= 30% size reduction, got {:.1}% (v1={} v2={})",
            reduction * 100.0,
            v1_size,
            v2_size
        );
    }

    // ========================================================================
    // Legacy String Tests
    // ========================================================================

    #[test]
    fn read_string_rejects_too_long() {
        let mut buf = BytesMut::new();
        (5u32).write(&mut buf);
        buf.extend_from_slice(b"hello");

        let mut reader = buf.as_ref();
        let err = read_string(&mut reader, 4).expect_err("should reject too-long string");
        assert!(matches!(err, Error::Invalid("String", "too long")));
    }

    #[test]
    fn read_string_rejects_truncated_buffers() {
        let mut buf = BytesMut::new();
        (3u32).write(&mut buf);
        buf.extend_from_slice(b"ab");

        let mut reader = buf.as_ref();
        let err = read_string(&mut reader, 10).expect_err("should reject truncated buffer");
        assert!(matches!(err, Error::EndOfBuffer));
    }

    #[test]
    fn read_string_rejects_invalid_utf8() {
        let mut buf = BytesMut::new();
        (2u32).write(&mut buf);
        buf.extend_from_slice(&[0xff, 0xff]);

        let mut reader = buf.as_ref();
        let err = read_string(&mut reader, 10).expect_err("should reject invalid UTF-8");
        assert!(matches!(err, Error::Invalid("String", "invalid UTF-8")));
    }

    #[test]
    fn read_string_handles_malformed_inputs() {
        let mut rng = StdRng::seed_from_u64(0x5eed_c0de);
        let max_len = 64;

        for len in [
            0usize, 1, 2, 3, 4, 7, 8, 15, 16, 31, 32, 63, 64, 127, 128, 256,
        ] {
            let mut buf = vec![0u8; len];
            rng.fill_bytes(&mut buf);
            let mut reader = buf.as_slice();
            let result = read_string(&mut reader, max_len);
            if let Ok(s) = result {
                assert!(s.len() <= max_len);
            }
        }

        for _ in 0..500 {
            let len = (rng.next_u32() as usize) % 512;
            let mut buf = vec![0u8; len];
            rng.fill_bytes(&mut buf);
            let mut reader = buf.as_slice();
            let result = read_string(&mut reader, max_len);
            if let Ok(s) = result {
                assert!(s.len() <= max_len);
            }
        }
    }
}

// ============================================================================
// Property Tests (proptest-based fuzz testing)
// ============================================================================
//
// These tests use proptest for property-based testing (structured fuzzing)
// of codec parsing to catch edge cases and boundary conditions.

#[cfg(test)]
mod proptest_fuzz {
    use super::*;
    use bytes::BytesMut;
    use proptest::prelude::*;

    // ========================================================================
    // BitWriter/BitReader Property Tests
    // ========================================================================

    proptest! {
        /// Property: Any sequence of bit writes should roundtrip correctly.
        /// Tests all bit counts 1-8 with arbitrary values.
        #[test]
        fn prop_bits_roundtrip(
            values in prop::collection::vec((1u8..=8u8, any::<u8>()), 1..50)
        ) {
            let mut writer = BitWriter::new();
            let mut expected = Vec::with_capacity(values.len());

            for (bits, value) in &values {
                let mask = if *bits == 8 { 0xFF } else { (1u8 << bits) - 1 };
                let masked_value = value & mask;
                writer.write_bits(*value, *bits);
                expected.push((masked_value, *bits));
            }

            let bytes = writer.finish();
            let mut reader = BitReader::new(&bytes);

            for (exp_val, bits) in expected {
                let read_val = reader.read_bits(bits);
                prop_assert_eq!(read_val, Some(exp_val), "bits={}", bits);
            }
        }

        /// Property: ULEB128 encoding should roundtrip for any u64.
        #[test]
        fn prop_uleb128_roundtrip(value: u64) {
            let mut writer = BitWriter::new();
            writer.write_uleb128(value);
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            prop_assert_eq!(reader.read_uleb128(), Some(value));
        }

        /// Property: ULEB128 encoding size should be bounded.
        /// Max size is 10 bytes for u64 (64 bits / 7 bits per byte = 10 bytes).
        #[test]
        fn prop_uleb128_size_bounded(value: u64) {
            let mut writer = BitWriter::new();
            writer.write_uleb128(value);
            let bytes = writer.finish();
            prop_assert!(bytes.len() <= 10, "ULEB128 exceeded 10 bytes");
        }

        /// Property: Small values should encode efficiently in ULEB128.
        #[test]
        fn prop_uleb128_small_values_compact(value in 0u64..128) {
            let mut writer = BitWriter::new();
            writer.write_uleb128(value);
            let bytes = writer.finish();
            prop_assert_eq!(bytes.len(), 1, "Values < 128 should encode in 1 byte");
        }

        /// Property: u16 roundtrip should preserve value.
        #[test]
        fn prop_u16_roundtrip(value: u16) {
            let mut writer = BitWriter::new();
            writer.write_u16(value);
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            prop_assert_eq!(reader.read_u16(), Some(value));
        }

        /// Property: u32 roundtrip should preserve value.
        #[test]
        fn prop_u32_roundtrip(value: u32) {
            let mut writer = BitWriter::new();
            writer.write_u32(value);
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            prop_assert_eq!(reader.read_u32(), Some(value));
        }

        /// Property: Reading more bits than available should return None.
        #[test]
        fn prop_read_past_end_returns_none(
            data in prop::collection::vec(any::<u8>(), 0..10),
            bits_to_read in 1u8..=8u8
        ) {
            let mut reader = BitReader::new(&data);
            let total_bits = data.len() * 8;

            // Consume all available bits
            let mut bits_consumed = 0usize;
            while bits_consumed + bits_to_read as usize <= total_bits {
                let result = reader.read_bits(bits_to_read);
                prop_assert!(result.is_some());
                bits_consumed += bits_to_read as usize;
            }

            // Next read should fail if we can't fit another full read
            if bits_consumed + bits_to_read as usize > total_bits {
                prop_assert_eq!(reader.read_bits(bits_to_read), None);
            }
        }

        /// Property: Envelope version check should only pass for v2.
        #[test]
        fn prop_envelope_version_check(opcode in 0u8..32) {
            let mut writer = BitWriter::new();
            writer.write_envelope(opcode);
            let bytes = writer.finish();

            let reader = BitReader::new(&bytes);
            prop_assert!(reader.is_v2());

            let mut reader2 = BitReader::new(&bytes);
            let envelope = reader2.read_envelope();
            prop_assert_eq!(envelope, Some((V2_PROTOCOL_VERSION, opcode)));
        }
    }

    // ========================================================================
    // BetDescriptorV2 Property Tests
    // ========================================================================

    proptest! {
        /// Property: Roulette bet descriptors should roundtrip.
        #[test]
        fn prop_bet_roulette_roundtrip(
            bet_type in 0u8..16,  // 4 bits
            target in 0u8..64,    // 6 bits
            amount in 1u64..1_000_000_000
        ) {
            let bet = BetDescriptorV2::new(bet_type, Some(target), amount);

            let mut writer = BitWriter::new();
            bet.encode_roulette(&mut writer);
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptorV2::decode_roulette(&mut reader);

            prop_assert!(decoded.is_some());
            let decoded = decoded.unwrap();
            prop_assert_eq!(decoded.bet_type, bet_type);
            prop_assert_eq!(decoded.target, Some(target));
            prop_assert_eq!(decoded.amount, amount);
        }

        /// Property: Sic Bo bet descriptors with target should roundtrip.
        #[test]
        fn prop_bet_sicbo_with_target_roundtrip(
            bet_type in 0u8..16,  // 4 bits
            target in 0u8..64,    // 6 bits
            amount in 1u64..1_000_000_000
        ) {
            let bet = BetDescriptorV2::new(bet_type, Some(target), amount);

            let mut writer = BitWriter::new();
            bet.encode_sic_bo(&mut writer, true);
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptorV2::decode_sic_bo(&mut reader, true);

            prop_assert!(decoded.is_some());
            let decoded = decoded.unwrap();
            prop_assert_eq!(decoded.bet_type, bet_type);
            prop_assert_eq!(decoded.target, Some(target));
            prop_assert_eq!(decoded.amount, amount);
        }

        /// Property: Sic Bo bet descriptors without target should roundtrip.
        #[test]
        fn prop_bet_sicbo_no_target_roundtrip(
            bet_type in 0u8..16,  // 4 bits
            amount in 1u64..1_000_000_000
        ) {
            let bet = BetDescriptorV2::new(bet_type, None, amount);

            let mut writer = BitWriter::new();
            bet.encode_sic_bo(&mut writer, false);
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptorV2::decode_sic_bo(&mut reader, false);

            prop_assert!(decoded.is_some());
            let decoded = decoded.unwrap();
            prop_assert_eq!(decoded.bet_type, bet_type);
            prop_assert_eq!(decoded.target, None);
            prop_assert_eq!(decoded.amount, amount);
        }

        /// Property: Baccarat bet descriptors should roundtrip.
        #[test]
        fn prop_bet_baccarat_roundtrip(
            bet_type in 0u8..16,  // 4 bits
            amount in 1u64..1_000_000_000
        ) {
            let bet = BetDescriptorV2::new(bet_type, None, amount);

            let mut writer = BitWriter::new();
            bet.encode_baccarat(&mut writer);
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptorV2::decode_baccarat(&mut reader);

            prop_assert!(decoded.is_some());
            let decoded = decoded.unwrap();
            prop_assert_eq!(decoded.bet_type, bet_type);
            prop_assert_eq!(decoded.target, None);
            prop_assert_eq!(decoded.amount, amount);
        }

        /// Property: Craps bet descriptors with target should roundtrip.
        #[test]
        fn prop_bet_craps_with_target_roundtrip(
            bet_type in 0u8..32,  // 5 bits
            target in 0u8..16,    // 4 bits
            amount in 1u64..1_000_000_000
        ) {
            let bet = BetDescriptorV2::new(bet_type, Some(target), amount);

            let mut writer = BitWriter::new();
            bet.encode_craps(&mut writer, true);
            let bytes = writer.finish();

            let mut reader = BitReader::new(&bytes);
            let decoded = BetDescriptorV2::decode_craps(&mut reader, true);

            prop_assert!(decoded.is_some());
            let decoded = decoded.unwrap();
            prop_assert_eq!(decoded.bet_type, bet_type);
            prop_assert_eq!(decoded.target, Some(target));
            prop_assert_eq!(decoded.amount, amount);
        }
    }

    // ========================================================================
    // Malformed Input Fuzz Tests
    // ========================================================================

    proptest! {
        /// Property: Arbitrary bytes should not crash BitReader.
        /// Reader should return None or valid values, never panic.
        #[test]
        fn prop_bitreader_no_panic_on_arbitrary_bytes(
            data in prop::collection::vec(any::<u8>(), 0..256)
        ) {
            let mut reader = BitReader::new(&data);

            // Try various read operations - should not panic
            let _ = reader.read_bits(4);
            let _ = reader.read_bits(8);
            let _ = reader.read_byte();
            let _ = reader.read_u16();
            let _ = reader.read_u32();
            let _ = reader.read_uleb128();
            let _ = reader.read_envelope();
            let _ = reader.is_v2();
            let _ = reader.remaining_bytes();
            let _ = reader.is_empty();
        }

        /// Property: Malformed ULEB128 should be handled gracefully.
        /// Specifically test continuation bytes that never terminate.
        #[test]
        fn prop_uleb128_malformed_continuation(
            data in prop::collection::vec(0x80u8..=0xFFu8, 1..20)
        ) {
            let mut reader = BitReader::new(&data);
            // All bytes have continuation bit set, should eventually return None
            // due to overflow protection
            let result = reader.read_uleb128();
            // Result should be None (overflow) or Some if we hit end of buffer
            // Either way, should not panic
            let _ = result;
        }

        /// Property: Decoding bet descriptor from random bytes should not panic.
        #[test]
        fn prop_bet_decode_no_panic(
            data in prop::collection::vec(any::<u8>(), 0..32)
        ) {
            // Roulette decode
            {
                let mut reader = BitReader::new(&data);
                let _ = BetDescriptorV2::decode_roulette(&mut reader);
            }

            // Sic Bo with target
            {
                let mut reader = BitReader::new(&data);
                let _ = BetDescriptorV2::decode_sic_bo(&mut reader, true);
            }

            // Sic Bo without target
            {
                let mut reader = BitReader::new(&data);
                let _ = BetDescriptorV2::decode_sic_bo(&mut reader, false);
            }

            // Baccarat
            {
                let mut reader = BitReader::new(&data);
                let _ = BetDescriptorV2::decode_baccarat(&mut reader);
            }

            // Craps with target
            {
                let mut reader = BitReader::new(&data);
                let _ = BetDescriptorV2::decode_craps(&mut reader, true);
            }
        }

        /// Property: Empty data should be handled gracefully.
        #[test]
        fn prop_empty_data_handled(bits in 1u8..=8u8) {
            let empty: &[u8] = &[];
            let mut reader = BitReader::new(empty);

            prop_assert_eq!(reader.read_bits(bits), None);
            prop_assert_eq!(reader.read_byte(), None);
            prop_assert_eq!(reader.read_u16(), None);
            prop_assert_eq!(reader.read_u32(), None);
            prop_assert_eq!(reader.read_uleb128(), None);
            prop_assert_eq!(reader.read_envelope(), None);
            prop_assert!(!reader.is_v2());
            prop_assert!(reader.is_empty());
        }
    }

    // ========================================================================
    // String Parsing Fuzz Tests
    // ========================================================================

    proptest! {
        /// Property: String parsing should not panic on arbitrary bytes.
        #[test]
        fn prop_string_parse_no_panic(
            data in prop::collection::vec(any::<u8>(), 0..512),
            max_len in 1usize..256
        ) {
            let mut reader = data.as_slice();
            let result = read_string(&mut reader, max_len);
            // Should either succeed with valid string or fail gracefully
            if let Ok(s) = result {
                prop_assert!(s.len() <= max_len);
            }
        }

        /// Property: Valid UTF-8 strings should roundtrip.
        #[test]
        fn prop_string_valid_roundtrip(
            s in "[a-zA-Z0-9 ]{0,100}"
        ) {
            let mut buf = BytesMut::new();
            write_string(&s, &mut buf);

            let mut reader = buf.as_ref();
            let result = read_string(&mut reader, 200);

            prop_assert!(result.is_ok());
            prop_assert_eq!(result.unwrap(), s);
        }

        /// Property: String encode size should match actual encoding.
        #[test]
        fn prop_string_encode_size_accurate(
            s in "[a-zA-Z0-9]{0,100}"
        ) {
            let expected_size = string_encode_size(&s);

            let mut buf = BytesMut::new();
            write_string(&s, &mut buf);

            prop_assert_eq!(buf.len(), expected_size);
        }
    }
}
