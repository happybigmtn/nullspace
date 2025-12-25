use commonware_runtime::{Clock, Handle, Metrics, Spawner};
use prometheus_client::metrics::gauge::Gauge;
use std::sync::atomic::AtomicU64;
use std::time::Duration;
use sysinfo::{Pid, ProcessExt, System, SystemExt};

const UPDATE_INTERVAL: Duration = Duration::from_secs(5);

pub fn spawn_process_metrics<E>(context: E) -> Handle<()>
where
    E: Clock + Metrics + Spawner + Clone + Send + Sync + 'static,
{
    let metrics_context = context.with_label("system");
    let rss_bytes: Gauge<u64, AtomicU64> = Gauge::default();
    let virtual_bytes: Gauge<u64, AtomicU64> = Gauge::default();
    let cpu_percent: Gauge<f64, AtomicU64> = Gauge::default();

    metrics_context.register(
        "process_rss_bytes",
        "Resident set size in bytes.",
        rss_bytes.clone(),
    );
    metrics_context.register(
        "process_virtual_bytes",
        "Virtual memory size in bytes.",
        virtual_bytes.clone(),
    );
    metrics_context.register(
        "process_cpu_percent",
        "Process CPU usage percentage.",
        cpu_percent.clone(),
    );

    metrics_context.spawn(move |context| async move {
        let pid = Pid::from_u32(std::process::id());
        let mut system = System::new();

        let mut update = || {
            system.refresh_cpu();
            system.refresh_process(pid);
            if let Some(process) = system.process(pid) {
                rss_bytes.set(process.memory().saturating_mul(1024));
                virtual_bytes.set(process.virtual_memory().saturating_mul(1024));
                cpu_percent.set(process.cpu_usage() as f64);
            } else {
                rss_bytes.set(0);
                virtual_bytes.set(0);
                cpu_percent.set(0.0);
            }
        };

        update();
        loop {
            context.sleep(UPDATE_INTERVAL).await;
            update();
        }
    })
}
