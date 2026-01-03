#!/usr/bin/env python3
import argparse
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LOGS = {
    "network": ROOT / "network.log",
    "auth": ROOT / "auth.log",
    "website": ROOT / "website.log",
}
PIDS = {
    "network": ROOT / "network.pid",
    "auth": ROOT / "auth.pid",
    "website": ROOT / "website.pid",
}


def read_env_file(path: Path) -> dict:
    data = {}
    if not path.exists():
        return data
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def ensure_website_env_local() -> Path:
    website_env = ROOT / "website" / ".env.local"
    if website_env.exists():
        return website_env
    fallback = ROOT / "configs" / "local" / ".env.local"
    if fallback.exists():
        website_env.parent.mkdir(parents=True, exist_ok=True)
        website_env.write_text(fallback.read_text())
        return website_env
    print("Missing website/.env.local and configs/local/.env.local. Create one first.", file=sys.stderr)
    sys.exit(1)


def run(cmd, *, cwd=None, env=None):
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def pid_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def terminate_pid(pid: int, timeout: float = 2.0):
    if not pid_exists(pid):
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    start = time.time()
    while time.time() - start < timeout:
        if not pid_exists(pid):
            return
        time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return


def kill_pidfile(path: Path):
    if not path.exists():
        return
    try:
        pid = int(path.read_text().strip())
    except ValueError:
        pid = None
    if pid:
        terminate_pid(pid)
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def kill_by_pattern(pattern: str):
    result = subprocess.run(
        ["pgrep", "-f", pattern],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return
    for token in result.stdout.split():
        if not token.isdigit():
            continue
        terminate_pid(int(token))


def start_process(name, cmd, *, cwd=None, env=None):
    LOGS[name].parent.mkdir(parents=True, exist_ok=True)
    log_file = open(LOGS[name], "a", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=log_file, stderr=log_file)
    PIDS[name].write_text(str(proc.pid))
    return proc


def tail_file(path: Path, prefix: str, stop_event: threading.Event):
    while not path.exists() and not stop_event.is_set():
        time.sleep(0.2)
    if stop_event.is_set():
        return
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        handle.seek(0, os.SEEK_END)
        while not stop_event.is_set():
            line = handle.readline()
            if line:
                sys.stdout.write(f"[{prefix}] {line}")
                sys.stdout.flush()
            else:
                time.sleep(0.2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Start local Nullspace stack and tail logs.")
    parser.add_argument("--web-port", type=int, default=5173)
    parser.add_argument("--config-dir", default=str(ROOT / "configs" / "local"))
    parser.add_argument("--nodes", type=int, default=4)
    parser.add_argument("--fresh", action="store_true", help="Prune node data before starting.")
    parser.add_argument("--no-build", action="store_true", help="Skip rebuilding simulator/node binaries.")
    args = parser.parse_args()

    # Clean up existing frontend/network/auth processes before restarting.
    for key in ("website", "network", "auth"):
        kill_pidfile(PIDS[key])
    for pattern in (
        "nullspace-simulator",
        "nullspace-node",
        "start-local-network.sh",
        "tsx src/server.ts",
        "node .*vite",
        "vite",
    ):
        kill_by_pattern(pattern)

    website_env_path = ensure_website_env_local()
    website_env = read_env_file(website_env_path)
    convex_env = read_env_file(ROOT / "docker" / "convex" / ".env")

    vite_identity = website_env.get("VITE_IDENTITY", "")
    convex_url = website_env.get("CONVEX_SELF_HOSTED_URL", "")
    convex_admin_key = website_env.get("CONVEX_SELF_HOSTED_ADMIN_KEY", "")
    if not vite_identity:
        print("Missing VITE_IDENTITY in website/.env.local", file=sys.stderr)
        return 1
    if not convex_url or not convex_admin_key:
        print("Missing CONVEX_SELF_HOSTED_URL or CONVEX_SELF_HOSTED_ADMIN_KEY in website/.env.local", file=sys.stderr)
        return 1

    service_token = convex_env.get("CONVEX_SERVICE_TOKEN", "")
    stripe_secret = convex_env.get("STRIPE_SECRET_KEY", "")
    stripe_webhook = convex_env.get("STRIPE_WEBHOOK_SECRET", "")
    if not service_token or not stripe_secret or not stripe_webhook:
        print("Missing Convex env vars in docker/convex/.env", file=sys.stderr)
        return 1

    config_dir = Path(args.config_dir)
    if not (config_dir / "node0.yaml").exists():
        print(f"Missing validator configs in {config_dir}. Run generate-keys first.", file=sys.stderr)
        return 1

    # Start Convex
    run(
        [
            "docker",
            "compose",
            "--env-file",
            str(ROOT / "docker" / "convex" / ".env"),
            "-f",
            str(ROOT / "docker" / "convex" / "docker-compose.yml"),
            "up",
            "-d",
            "--wait",
        ],
        cwd=ROOT,
    )

    convex_env_vars = os.environ.copy()
    convex_env_vars["CONVEX_SELF_HOSTED_URL"] = convex_url
    convex_env_vars["CONVEX_SELF_HOSTED_ADMIN_KEY"] = convex_admin_key
    run(
        ["npx", "convex", "env", "set", "CONVEX_SERVICE_TOKEN", service_token],
        cwd=ROOT / "website",
        env=convex_env_vars,
    )
    run(
        ["npx", "convex", "env", "set", "STRIPE_SECRET_KEY", stripe_secret],
        cwd=ROOT / "website",
        env=convex_env_vars,
    )
    run(
        ["npx", "convex", "env", "set", "STRIPE_WEBHOOK_SECRET", stripe_webhook],
        cwd=ROOT / "website",
        env=convex_env_vars,
    )
    run(
        ["npx", "convex", "dev", "--once"],
        cwd=ROOT / "website",
        env=convex_env_vars,
    )

    allowed_origins = ",".join(
        [
            f"http://localhost:{args.web_port}",
            f"http://127.0.0.1:{args.web_port}",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )

    network_env = os.environ.copy()
    network_env.update(
        {
            "ALLOW_HTTP_NO_ORIGIN": "1",
            "ALLOW_WS_NO_ORIGIN": "1",
            "ALLOWED_HTTP_ORIGINS": allowed_origins,
            "ALLOWED_WS_ORIGINS": allowed_origins,
        }
    )

    processes = []
    network_cmd = [
        str(ROOT / "scripts" / "start-local-network.sh"),
        str(config_dir),
        str(args.nodes),
    ]
    if args.fresh:
        network_cmd.append("--fresh")
    if args.no_build:
        network_cmd.append("--no-build")
    processes.append(
        start_process(
            "network",
            network_cmd,
            env=network_env,
        )
    )
    processes.append(
        start_process(
            "auth",
            ["npm", "run", "dev"],
            cwd=ROOT / "services" / "auth",
            env={**os.environ, "AUTH_ALLOWED_ORIGINS": allowed_origins},
        )
    )
    processes.append(
        start_process(
            "website",
            ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(args.web_port)],
            cwd=ROOT / "website",
            env=os.environ.copy(),
        )
    )

    stop_event = threading.Event()

    def handle_signal(_sig, _frame):
        stop_event.set()
        for proc in processes:
            proc.terminate()
        time.sleep(1)
        for proc in processes:
            if proc.poll() is None:
                proc.kill()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    threads = []
    for name, log_path in LOGS.items():
        thread = threading.Thread(target=tail_file, args=(log_path, name, stop_event), daemon=True)
        thread.start()
        threads.append(thread)

    print("Streaming logs (Ctrl+C to stop; services will be terminated).")
    print(f"UI: http://127.0.0.1:{args.web_port}")

    try:
        while not stop_event.is_set():
            time.sleep(0.5)
    finally:
        stop_event.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
