//! Cross-platform consistency tests for determinism (DET-3).
//!
//! These tests validate that binary encoding/decoding produces identical results
//! across different CPU architectures (x86, ARM, etc.) by explicitly using
//! big-endian byte order and verifying round-trip consistency.
//!
//! This is critical for ensuring that validators on different hardware platforms
//! reach consensus on transaction execution and state transitions.

#[cfg(test)]
mod tests {
    use crate::casino::serialization::{StateReader, StateWriter};

    #[test]
    fn test_explicit_big_endian_u16() {
        // Verify u16 is always encoded as big-endian regardless of platform
        let mut writer = StateWriter::with_capacity(2);
        writer.push_u16_be(0x1234);
        let bytes = writer.into_inner();

        // Big-endian: most significant byte first
        assert_eq!(bytes, vec![0x12, 0x34], "u16 must be big-endian");

        // Verify round-trip
        let mut reader = StateReader::new(&bytes);
        let value = reader.read_u16_be().expect("should read u16");
        assert_eq!(value, 0x1234, "round-trip should preserve value");
    }

    #[test]
    fn test_explicit_big_endian_u32() {
        let mut writer = StateWriter::with_capacity(4);
        writer.push_u32_be(0x12345678);
        let bytes = writer.into_inner();

        assert_eq!(
            bytes,
            vec![0x12, 0x34, 0x56, 0x78],
            "u32 must be big-endian"
        );

        let mut reader = StateReader::new(&bytes);
        let value = reader.read_u32_be().expect("should read u32");
        assert_eq!(value, 0x12345678, "round-trip should preserve value");
    }

    #[test]
    fn test_explicit_big_endian_u64() {
        let mut writer = StateWriter::with_capacity(8);
        writer.push_u64_be(0x123456789ABCDEF0);
        let bytes = writer.into_inner();

        assert_eq!(
            bytes,
            vec![0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0],
            "u64 must be big-endian"
        );

        let mut reader = StateReader::new(&bytes);
        let value = reader.read_u64_be().expect("should read u64");
        assert_eq!(
            value, 0x123456789ABCDEF0,
            "round-trip should preserve value"
        );
    }

    #[test]
    fn test_explicit_big_endian_i64() {
        let mut writer = StateWriter::with_capacity(8);
        writer.push_i64_be(-0x123456789ABCDEF0);
        let bytes = writer.into_inner();

        // Negative numbers in two's complement big-endian
        let expected: Vec<u8> = (-0x123456789ABCDEF0i64).to_be_bytes().to_vec();
        assert_eq!(bytes, expected, "i64 must be big-endian");

        let mut reader = StateReader::new(&bytes);
        let value = reader.read_i64_be().expect("should read i64");
        assert_eq!(
            value, -0x123456789ABCDEF0,
            "round-trip should preserve value"
        );
    }

    #[test]
    fn test_endianness_independence() {
        // Test that encoding is independent of native platform endianness
        // by using values that differ between little-endian and big-endian

        let test_value = 0x0102030405060708u64;
        let mut writer = StateWriter::with_capacity(8);
        writer.push_u64_be(test_value);
        let bytes = writer.into_inner();

        // On little-endian: [08, 07, 06, 05, 04, 03, 02, 01]
        // On big-endian:    [01, 02, 03, 04, 05, 06, 07, 08]
        // We want big-endian regardless of platform
        assert_eq!(
            bytes,
            vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
            "encoding must be big-endian regardless of platform"
        );

        // Verify this matches Rust's to_be_bytes()
        assert_eq!(
            bytes,
            test_value.to_be_bytes().to_vec(),
            "must match Rust's to_be_bytes"
        );
    }

    #[test]
    fn test_multiple_values_concatenation() {
        // Test that multiple values concatenate correctly in big-endian order
        let mut writer = StateWriter::with_capacity(24);
        writer.push_u16_be(0xABCD);
        writer.push_u32_be(0x12345678);
        writer.push_u64_be(0xFEDCBA9876543210);
        let bytes = writer.into_inner();

        assert_eq!(
            bytes,
            vec![
                0xAB, 0xCD, // u16
                0x12, 0x34, 0x56, 0x78, // u32
                0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10, // u64
            ],
            "multiple values must concatenate in big-endian order"
        );

        // Verify round-trip
        let mut reader = StateReader::new(&bytes);
        assert_eq!(reader.read_u16_be().unwrap(), 0xABCD);
        assert_eq!(reader.read_u32_be().unwrap(), 0x12345678);
        assert_eq!(reader.read_u64_be().unwrap(), 0xFEDCBA9876543210);
    }

    #[test]
    fn test_zero_and_max_values() {
        // Test boundary values to ensure no special-casing
        let mut writer = StateWriter::with_capacity(48);

        // Zero values
        writer.push_u16_be(0);
        writer.push_u32_be(0);
        writer.push_u64_be(0);

        // Max values
        writer.push_u16_be(u16::MAX);
        writer.push_u32_be(u32::MAX);
        writer.push_u64_be(u64::MAX);

        let bytes = writer.into_inner();

        let mut reader = StateReader::new(&bytes);

        // Verify zeros
        assert_eq!(reader.read_u16_be().unwrap(), 0);
        assert_eq!(reader.read_u32_be().unwrap(), 0);
        assert_eq!(reader.read_u64_be().unwrap(), 0);

        // Verify maxes
        assert_eq!(reader.read_u16_be().unwrap(), u16::MAX);
        assert_eq!(reader.read_u32_be().unwrap(), u32::MAX);
        assert_eq!(reader.read_u64_be().unwrap(), u64::MAX);
    }

    #[test]
    fn test_signed_integer_encoding() {
        // Test that signed integers use two's complement big-endian
        let test_cases = vec![
            (0i64, vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
            (1i64, vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]),
            (-1i64, vec![0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
            (
                i64::MAX,
                vec![0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
            ),
            (
                i64::MIN,
                vec![0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
            ),
        ];

        for (value, expected_bytes) in test_cases {
            let mut writer = StateWriter::with_capacity(8);
            writer.push_i64_be(value);
            let bytes = writer.into_inner();

            assert_eq!(
                bytes, expected_bytes,
                "i64 value {} should encode correctly",
                value
            );

            // Verify it matches Rust's to_be_bytes
            assert_eq!(
                bytes,
                value.to_be_bytes().to_vec(),
                "must match Rust's to_be_bytes for {}",
                value
            );

            // Verify round-trip
            let mut reader = StateReader::new(&bytes);
            let decoded = reader.read_i64_be().expect("should decode");
            assert_eq!(decoded, value, "round-trip should preserve {}", value);
        }
    }

    #[test]
    fn test_byte_array_encoding_preserves_order() {
        // Test that byte arrays are written and read in the same order
        let test_bytes = vec![0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF];

        let mut writer = StateWriter::with_capacity(test_bytes.len());
        writer.push_bytes(&test_bytes);
        let encoded = writer.into_inner();

        assert_eq!(
            encoded, test_bytes,
            "byte arrays should preserve exact order"
        );

        let mut reader = StateReader::new(&encoded);
        let decoded = reader.read_bytes(test_bytes.len()).expect("should read bytes");
        assert_eq!(decoded, test_bytes, "round-trip should preserve byte order");
    }

    #[test]
    fn test_cross_platform_golden_vector() {
        // Golden vector: a specific encoding that should be identical across all platforms
        // This represents a complex state blob with multiple field types

        let mut writer = StateWriter::with_capacity(64);

        // Version byte
        writer.push_u8(4);

        // Game state fields
        writer.push_u64_be(1000); // chips
        writer.push_u64_be(500); // balance
        writer.push_u16_be(3); // shields
        writer.push_u16_be(2); // doubles
        writer.push_i64_be(-100); // profit/loss

        // Card data (suit, rank)
        writer.push_bytes(&[0, 13]); // A♠
        writer.push_bytes(&[1, 12]); // K♥

        let encoded = writer.into_inner();

        // Golden bytes - this exact sequence should be produced on all platforms
        let expected = vec![
            0x04, // version
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xE8, // chips = 1000
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0xF4, // balance = 500
            0x00, 0x03, // shields = 3
            0x00, 0x02, // doubles = 2
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x9C, // profit = -100
            0x00, 0x0D, // A♠
            0x01, 0x0C, // K♥
        ];

        assert_eq!(
            encoded, expected,
            "golden vector must produce identical bytes on all platforms"
        );

        // Verify we can decode it back
        let mut reader = StateReader::new(&encoded);
        assert_eq!(reader.read_u8().unwrap(), 4);
        assert_eq!(reader.read_u64_be().unwrap(), 1000);
        assert_eq!(reader.read_u64_be().unwrap(), 500);
        assert_eq!(reader.read_u16_be().unwrap(), 3);
        assert_eq!(reader.read_u16_be().unwrap(), 2);
        assert_eq!(reader.read_i64_be().unwrap(), -100);
        assert_eq!(reader.read_bytes(2).unwrap(), vec![0, 13]);
        assert_eq!(reader.read_bytes(2).unwrap(), vec![1, 12]);
    }

    #[test]
    fn test_platform_independence_via_hex() {
        // Test using hex strings to verify platform-independent encoding
        // This is how we'd compare with other implementations (e.g., TypeScript)

        let mut writer = StateWriter::with_capacity(16);
        writer.push_u64_be(0x0123456789ABCDEF);
        writer.push_u64_be(0xFEDCBA9876543210);
        let bytes = writer.into_inner();

        // Convert to hex string
        let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();

        assert_eq!(
            hex, "0123456789abcdeffedcba9876543210",
            "hex encoding must be consistent"
        );

        // Verify we can parse it back
        let parsed_bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect();

        assert_eq!(parsed_bytes, bytes, "hex round-trip should preserve bytes");
    }

    #[test]
    fn test_alignment_independence() {
        // Test that encoding doesn't depend on memory alignment
        // by encoding values at different buffer positions

        // Encode at offset 0 (aligned)
        let mut writer1 = StateWriter::with_capacity(8);
        writer1.push_u64_be(0x1122334455667788);
        let bytes1 = writer1.into_inner();

        // Encode at offset 3 (unaligned)
        let mut writer2 = StateWriter::with_capacity(11);
        writer2.push_bytes(&[0xAA, 0xBB, 0xCC]); // padding
        writer2.push_u64_be(0x1122334455667788);
        let bytes2 = writer2.into_inner();

        // The u64 bytes should be identical regardless of alignment
        assert_eq!(&bytes2[3..11], bytes1.as_slice());
        assert_eq!(
            &bytes2[3..11],
            &[0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]
        );
    }
}
