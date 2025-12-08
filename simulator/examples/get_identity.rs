use commonware_codec::Encode;
use commonware_cryptography::bls12381::primitives::{ops, variant::MinSig};
use rand::SeedableRng;

fn main() {
    let mut rng = rand::rngs::StdRng::seed_from_u64(0);
    let (_, identity) = ops::keypair::<_, MinSig>(&mut rng);
    let bytes = identity.encode();
    println!("{}", commonware_utils::hex(&bytes));
}
