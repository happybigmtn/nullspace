use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, System};

const LATENCY_BUCKET_COUNT: usize = 12;
const LATENCY_BUCKETS_MS: [u64; LATENCY_BUCKET_COUNT] =
    [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

#[derive(Clone, Debug, Serialize)]
pub struct LatencySnapshot {
    pub buckets_ms: Vec<u64>,
    pub counts: Vec<u64>,
    pub overflow: u64,
    pub count: u64,
    pub avg_ms: f64,
    pub max_ms: u64,
}

#[derive(Default)]
struct LatencyMetrics {
    buckets: [AtomicU64; LATENCY_BUCKET_COUNT],
    overflow: AtomicU64,
    count: AtomicU64,
    total_ms: AtomicU64,
    max_ms: AtomicU64,
}

impl LatencyMetrics {
    fn record(&self, duration: Duration) {
        let ms = duration.as_millis() as u64;
        self.count.fetch_add(1, Ordering::Relaxed);
        self.total_ms.fetch_add(ms, Ordering::Relaxed);
        self.update_max(ms);

        if let Some((idx, _)) = LATENCY_BUCKETS_MS.iter().enumerate().find(|(_, bucket)| ms <= **bucket) {
            self.buckets[idx].fetch_add(1, Ordering::Relaxed);
        } else {
            self.overflow.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn snapshot(&self) -> LatencySnapshot {
        let count = self.count.load(Ordering::Relaxed);
        let total_ms = self.total_ms.load(Ordering::Relaxed);
        let avg_ms = if count > 0 {
            total_ms as f64 / count as f64
        } else {
            0.0
        };
        let counts = self
            .buckets
            .iter()
            .map(|bucket| bucket.load(Ordering::Relaxed))
            .collect::<Vec<_>>();

        LatencySnapshot {
            buckets_ms: LATENCY_BUCKETS_MS.to_vec(),
            counts,
            overflow: self.overflow.load(Ordering::Relaxed),
            count,
            avg_ms,
            max_ms: self.max_ms.load(Ordering::Relaxed),
        }
    }

    fn update_max(&self, value: u64) {
        let mut current = self.max_ms.load(Ordering::Relaxed);
        while value > current {
            match self.max_ms.compare_exchange_weak(
                current,
                value,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(next) => current = next,
            }
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct HttpMetricsSnapshot {
    pub submit: LatencySnapshot,
    pub query_state: LatencySnapshot,
    pub query_seed: LatencySnapshot,
}

#[derive(Default)]
pub struct HttpMetrics {
    submit: LatencyMetrics,
    query_state: LatencyMetrics,
    query_seed: LatencyMetrics,
}

impl HttpMetrics {
    pub fn record_submit(&self, duration: Duration) {
        self.submit.record(duration);
    }

    pub fn record_query_state(&self, duration: Duration) {
        self.query_state.record(duration);
    }

    pub fn record_query_seed(&self, duration: Duration) {
        self.query_seed.record(duration);
    }

    pub fn snapshot(&self) -> HttpMetricsSnapshot {
        HttpMetricsSnapshot {
            submit: self.submit.snapshot(),
            query_state: self.query_state.snapshot(),
            query_seed: self.query_seed.snapshot(),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct SystemMetricsSnapshot {
    pub rss_bytes: u64,
    pub virtual_bytes: u64,
    pub cpu_usage_percent: f64,
}

pub struct SystemMetrics {
    system: Mutex<System>,
    pid: Pid,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpdateIndexMetricsSnapshot {
    pub proof_build: LatencySnapshot,
    pub in_flight: u64,
    pub max_in_flight: u64,
    pub failures: u64,
}

#[derive(Default)]
pub struct UpdateIndexMetrics {
    proof_build: LatencyMetrics,
    in_flight: AtomicU64,
    max_in_flight: AtomicU64,
    failures: AtomicU64,
}

impl UpdateIndexMetrics {
    pub fn record_proof_latency(&self, duration: Duration) {
        self.proof_build.record(duration);
    }

    pub fn inc_in_flight(&self) {
        let current = self.in_flight.fetch_add(1, Ordering::Relaxed) + 1;
        let mut max = self.max_in_flight.load(Ordering::Relaxed);
        while current > max {
            match self.max_in_flight.compare_exchange_weak(
                max,
                current,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(next) => max = next,
            }
        }
    }

    pub fn dec_in_flight(&self) {
        let mut current = self.in_flight.load(Ordering::Relaxed);
        while current > 0 {
            match self.in_flight.compare_exchange_weak(
                current,
                current - 1,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(next) => current = next,
            }
        }
    }

    pub fn inc_failure(&self) {
        self.failures.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> UpdateIndexMetricsSnapshot {
        UpdateIndexMetricsSnapshot {
            proof_build: self.proof_build.snapshot(),
            in_flight: self.in_flight.load(Ordering::Relaxed),
            max_in_flight: self.max_in_flight.load(Ordering::Relaxed),
            failures: self.failures.load(Ordering::Relaxed),
        }
    }
}

impl SystemMetrics {
    pub fn new() -> Self {
        let system = System::new();
        let pid = Pid::from_u32(std::process::id());
        Self {
            system: Mutex::new(system),
            pid,
        }
    }

    pub fn snapshot(&self) -> SystemMetricsSnapshot {
        let mut system = self.system.lock().unwrap();
        system.refresh_cpu_usage();
        system.refresh_processes(ProcessesToUpdate::Some(&[self.pid]), false);

        if let Some(process) = system.process(self.pid) {
            SystemMetricsSnapshot {
                rss_bytes: process.memory().saturating_mul(1024),
                virtual_bytes: process.virtual_memory().saturating_mul(1024),
                cpu_usage_percent: process.cpu_usage() as f64,
            }
        } else {
            SystemMetricsSnapshot {
                rss_bytes: 0,
                virtual_bytes: 0,
                cpu_usage_percent: 0.0,
            }
        }
    }
}
