//! Shared helpers for consensus-critical casino state blobs.

#[derive(Clone, Copy, Debug)]
pub(crate) struct StateReader<'a> {
    buf: &'a [u8],
    offset: usize,
}

impl<'a> StateReader<'a> {
    pub(crate) fn new(buf: &'a [u8]) -> Self {
        Self { buf, offset: 0 }
    }

    pub(crate) fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.offset)
    }

    pub(crate) fn read_u8(&mut self) -> Option<u8> {
        let value = *self.buf.get(self.offset)?;
        self.offset += 1;
        Some(value)
    }

    #[allow(dead_code)]
    pub(crate) fn read_u16_be(&mut self) -> Option<u16> {
        let bytes = self.read_bytes(2)?;
        Some(u16::from_be_bytes(bytes.try_into().ok()?))
    }

    #[allow(dead_code)]
    pub(crate) fn read_u32_be(&mut self) -> Option<u32> {
        let bytes = self.read_bytes(4)?;
        Some(u32::from_be_bytes(bytes.try_into().ok()?))
    }

    pub(crate) fn read_u64_be(&mut self) -> Option<u64> {
        let bytes = self.read_bytes(8)?;
        Some(u64::from_be_bytes(bytes.try_into().ok()?))
    }

    pub(crate) fn read_i64_be(&mut self) -> Option<i64> {
        let bytes = self.read_bytes(8)?;
        Some(i64::from_be_bytes(bytes.try_into().ok()?))
    }

    pub(crate) fn read_bytes(&mut self, len: usize) -> Option<&'a [u8]> {
        if self.remaining() < len {
            return None;
        }
        let start = self.offset;
        self.offset += len;
        Some(&self.buf[start..self.offset])
    }

    pub(crate) fn read_vec(&mut self, len: usize) -> Option<Vec<u8>> {
        Some(self.read_bytes(len)?.to_vec())
    }
}

#[derive(Debug)]
pub(crate) struct StateWriter {
    buf: Vec<u8>,
}

impl StateWriter {
    pub(crate) fn with_capacity(capacity: usize) -> Self {
        Self {
            buf: Vec::with_capacity(capacity),
        }
    }

    pub(crate) fn push_u8(&mut self, value: u8) {
        self.buf.push(value);
    }

    #[allow(dead_code)]
    pub(crate) fn push_u16_be(&mut self, value: u16) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }

    pub(crate) fn push_u32_be(&mut self, value: u32) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }

    pub(crate) fn push_u64_be(&mut self, value: u64) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }

    pub(crate) fn push_i64_be(&mut self, value: i64) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }

    pub(crate) fn push_bytes(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }

    pub(crate) fn into_inner(self) -> Vec<u8> {
        self.buf
    }
}
