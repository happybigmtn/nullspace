# Postgres Ops Runbook (Explorer Persistence)

This runbook covers a self-managed Postgres instance for the simulator/indexer
explorer persistence layer. It is written for Ubuntu 22.04+ and assumes a
dedicated Postgres host.

## 1) Provision host + volume
- Use a dedicated VM with NVMe storage (see `docs/resource_sizing.md`).
- Attach a data volume and mount at `/var/lib/postgresql`.
- Ensure the VM is on the private network; do not expose 5432 to the internet.

## 2) Install Postgres
```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
```

Confirm version:
```bash
psql --version
```

## 3) Core configuration
Edit `/etc/postgresql/<version>/main/postgresql.conf`:

```
listen_addresses = '10.0.1.10'
shared_buffers = 8GB
effective_cache_size = 24GB
work_mem = 16MB
maintenance_work_mem = 1GB
max_connections = 200
wal_level = replica
max_wal_size = 8GB
min_wal_size = 2GB
checkpoint_completion_target = 0.9
wal_compression = on
```

Enable extensions:
```
shared_preload_libraries = 'pg_stat_statements'
```

## 4) Network access
Edit `/etc/postgresql/<version>/main/pg_hba.conf`:
```
host  all  all  10.0.0.0/16  scram-sha-256
```

Restart Postgres:
```bash
sudo systemctl restart postgresql
```

## 5) Database + user
```bash
sudo -u postgres psql
CREATE USER nullspace WITH PASSWORD '<strong-password>';
CREATE DATABASE nullspace_explorer OWNER nullspace;
GRANT ALL PRIVILEGES ON DATABASE nullspace_explorer TO nullspace;
\\q
```

Connection string (use in simulator):
```
postgres://nullspace:<password>@10.0.1.10:5432/nullspace_explorer
```

## 6) Connection pooling (pgbouncer)
Install pgbouncer:
```bash
sudo apt-get install -y pgbouncer
```

Edit `/etc/pgbouncer/pgbouncer.ini`:
```
[databases]
nullspace_explorer = host=127.0.0.1 port=5432 dbname=nullspace_explorer

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 50
reserve_pool_size = 50
```

Create userlist:
```
"nullspace" "<md5-or-scram-password>"
```

Restart pgbouncer:
```bash
sudo systemctl restart pgbouncer
```

Update simulator to point at port 6432 instead of 5432.

## 7) Backups + WAL archiving (pgbackrest)
Install pgbackrest:
```bash
sudo apt-get install -y pgbackrest
```

Example `/etc/pgbackrest.conf` (S3-compatible):
```
[global]
repo1-type=s3
repo1-s3-endpoint=s3.us-east-1.amazonaws.com
repo1-s3-region=us-east-1
repo1-s3-bucket=nullspace-backups
repo1-s3-key=<access-key>
repo1-s3-key-secret=<secret>
repo1-retention-full=7
start-fast=y

[nullspace]
pg1-path=/var/lib/postgresql/<version>/main
```

Enable archiving in `postgresql.conf`:
```
archive_mode = on
archive_command = 'pgbackrest --stanza=nullspace archive-push %p'
```

Initialize:
```bash
sudo -u postgres pgbackrest --stanza=nullspace stanza-create
sudo -u postgres pgbackrest --stanza=nullspace --type=full backup
```

Set a daily backup timer (systemd) or a cron job.

## 8) Restore drill (quarterly)
```bash
sudo systemctl stop postgresql
sudo -u postgres pgbackrest --stanza=nullspace restore --delta
sudo systemctl start postgresql
```

Validate with a read-only simulator pointing at the restored instance.

## 9) Monitoring
- Enable `pg_stat_statements` and export metrics via `postgres_exporter`.
- Track: connection count, cache hit rate, slow queries, and WAL lag.
