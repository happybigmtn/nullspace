use crate::api::{Query, UpdatesFilter};
use crate::execution::{Instruction, Transaction};
use commonware_codec::Encode;
use commonware_cryptography::{ed25519::PrivateKey, PrivateKeyExt};

#[test]
fn query_encoding_is_stable() {
    assert_eq!(Query::Latest.encode().as_ref(), &[0u8]);
    assert_eq!(
        Query::Index(42).encode().as_ref(),
        &[1u8, 0, 0, 0, 0, 0, 0, 0, 42]
    );
}

#[test]
fn updates_filter_encoding_is_stable() {
    assert_eq!(UpdatesFilter::All.encode().as_ref(), &[0u8]);
}

#[test]
fn transaction_encoding_is_stable() {
    let private = PrivateKey::from_seed(1);
    let tx = Transaction::sign(&private, 0, Instruction::CasinoDeposit { amount: 100 });

    let expected = commonware_utils::from_hex(
        "00000000000000000b0000000000000064478b8e507e0bb2b18c0f9e0824769e8562d10df9abe2e774896f82b4b4405266c3e9d35ecbba32fae5dbbe0d5c338d874c2a4476f2a23bc5a0a49c87589d3325ab971d2f19f08e411ef22483c9c4f6f0cfc818ea163048eac8a41cf6ff179a02",
    )
    .expect("valid hex");
    assert_eq!(tx.encode().as_ref(), expected.as_slice());
}
