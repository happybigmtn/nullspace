use bytes::{Buf, BufMut};
use commonware_codec::{Error, ReadExt, Write};

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
    use rand::{rngs::StdRng, RngCore, SeedableRng};

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
