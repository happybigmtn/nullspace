//! Debug: Print hex encoding of Transaction submission

use commonware_codec::Encode;
use commonware_cryptography::{ed25519::PrivateKey, Signer};
use nullspace_types::{
    api::Submission,
    execution::{Instruction, Transaction},
};

fn main() {
    let signer = PrivateKey::from_seed(1000);
    let tx = Transaction::sign(
        &signer,
        0,
        Instruction::CasinoRegister {
            name: "TestPlayer".to_string(),
        },
    );

    let submission = Submission::Transactions(vec![tx]);
    let encoded = submission.encode().to_vec();

    println!("Length: {}", encoded.len());
    println!(
        "Hex (first 64 bytes): {}",
        commonware_utils::hex(&encoded[..std::cmp::min(64, encoded.len())])
    );
    println!(
        "Full hex: {}",
        commonware_utils::hex(&encoded)
    );
}
