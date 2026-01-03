use commonware_cryptography::{
    ed25519::{PrivateKey, PublicKey},
    Signer,
};
use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use nullspace_types::Tournament;

fn setup_tournament(size: usize) -> (Tournament, PublicKey, PublicKey, PublicKey) {
    let mut keys: Vec<PublicKey> = (0..(size as u64 + 2))
        .map(|seed| PrivateKey::from_seed(seed).public_key())
        .collect();
    keys.sort_unstable();

    let players = keys[1..=size].to_vec();
    let hit = keys[1 + size / 2].clone();
    let miss_low = keys[0].clone();
    let miss_high = keys[size + 1].clone();

    let tournament = Tournament {
        players,
        ..Default::default()
    };
    (tournament, hit, miss_low, miss_high)
}

fn tournament_membership(c: &mut Criterion) {
    let mut group = c.benchmark_group("tournament_membership");
    for size in [10usize, 100, 1_000] {
        let (base, hit, miss_low, miss_high) = setup_tournament(size);

        group.bench_function(BenchmarkId::new("contains_hit", size), |b| {
            b.iter(|| black_box(base.contains_player(&hit)))
        });

        group.bench_function(BenchmarkId::new("contains_miss", size), |b| {
            b.iter(|| black_box(base.contains_player(&miss_high)))
        });

        group.bench_function(BenchmarkId::new("add_existing", size), |b| {
            let mut t = base.clone();
            b.iter(|| black_box(t.add_player(hit.clone())))
        });

        group.bench_function(BenchmarkId::new("add_new_low_add_remove", size), |b| {
            let mut t = base.clone();
            b.iter(|| {
                black_box(t.add_player(miss_low.clone()));
                let pos = t.players.binary_search(&miss_low).expect("inserted");
                t.players.remove(pos);
            })
        });

        group.bench_function(BenchmarkId::new("add_new_high_add_remove", size), |b| {
            let mut t = base.clone();
            b.iter(|| {
                black_box(t.add_player(miss_high.clone()));
                let pos = t.players.binary_search(&miss_high).expect("inserted");
                t.players.remove(pos);
            })
        });
    }
    group.finish();
}

criterion_group!(benches, tournament_membership);
criterion_main!(benches);
