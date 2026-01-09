# E26 - Terraform infrastructure (declarative IaC patterns)

Focus directory: `terraform/`

Goal: explain the Terraform module structure for Nullspace infrastructure, how staging and production environments differ, how modules compose to create a secure private network topology, and how state management and secrets integrate with the deployment workflow.

---

## Learning objectives

After this lesson you should be able to:

1) Describe the Terraform module hierarchy and reusability model.
2) Explain the network, firewall, server, and load-balancer modules.
3) Understand staging vs production configuration differences.
4) Describe S3-compatible state backend configuration.
5) Explain SOPS integration for secrets management.
6) Understand the deployment workflow from init to apply.

---

## 1) Context: why Terraform and why modules

Terraform is declarative infrastructure as code. You describe the desired state, and Terraform converges to that state. The key benefit is reproducibility: the same Terraform code produces the same infrastructure every time.

Nullspace uses Terraform to provision Hetzner Cloud infrastructure for both staging and production. The design follows a module-based pattern:

- Reusable modules define primitives (network, firewall, server, load-balancer).
- Environment-specific configurations compose those modules with different parameters.
- State is stored in S3-compatible backends for team collaboration.

This lesson focuses on understanding the module structure and how staging vs production differ.

---

## 2) Directory structure and module organization

The Terraform directory is organized as follows:

```
terraform/
├── modules/                    # Reusable modules
│   ├── network/               # VPC and subnets
│   ├── firewall/              # Security rules
│   ├── server/                # Compute instances
│   └── load-balancer/         # L4/L7 load balancers
├── environments/
│   ├── staging/               # ~5k concurrent players
│   └── production/            # ~20k+ concurrent players
└── versions.tf                # Provider requirements
```

### 2.1 Module vs environment separation

Modules are generic building blocks. They define resources but do not hardcode values. Instead, they accept variables and outputs.

Environments are specific configurations. They instantiate modules with concrete values for staging or production.

This separation is standard Terraform practice. It allows you to:

- Reuse modules across environments.
- Test changes in staging before applying to production.
- Avoid duplication and drift.

### 2.2 Why this structure scales

As the system grows, you can add new environments (testnet, canary, etc.) by creating new environment directories. You do not need to copy module code. This is the core benefit of modularization.

---

## 3) Network module: private CIDR and subnet allocation

The network module (`modules/network/main.tf`) creates the private network and subnets.

Key resources:

- `hcloud_network`: Creates a private network with CIDR `10.0.0.0/16`.
- `hcloud_network_subnet`: Creates subnets within that network.
  - Services subnet: `10.0.1.0/24` (all services).
  - Observability subnet: `10.0.2.0/24` (production only, optional).

### 3.1 Why /16 with /24 subnets

A /16 gives you 65,536 IPs. A /24 gives you 254 usable IPs per subnet. This is more than enough for current scale but leaves room for future segmentation.

For example, production creates a separate observability subnet. This allows you to apply different firewall rules to observability stack vs services. In the future, you could create dedicated subnets for validators, databases, and gateways.

### 3.2 Private network as default

All servers are attached to the private network by default. Only load balancers and bastions get public IPs. This is the same security model described in E14 (Hetzner runbook).

The network module enforces this by making private network attachment mandatory for all servers. Public IP assignment is controlled by the server module's `enable_public_ipv4` flag.

---

## 4) Firewall module: security rules by role

The firewall module (`modules/firewall/main.tf`) creates Hetzner Cloud firewalls for different roles.

Firewalls defined:

1. **Bastion firewall**: SSH from admin IPs only.
2. **Web firewall**: HTTP/HTTPS from public, SSH from admin IPs.
3. **Internal firewall**: Service-to-service ports (8080, 9010, 4000, 9020) from private network.
4. **Validator firewall**: P2P ports (9001-9004) and metrics ports (9100-9104).
5. **Database firewall**: Postgres (5432) from private network only.
6. **Observability firewall**: Prometheus (9090), Grafana (3000-3001), Loki (3100), Tempo (4317-4318).

### 4.1 Firewall assignment by server role

Each server instance is assigned a firewall based on its role. For example:

- Gateways get the internal firewall (8080, 9010).
- Validators get the validator firewall (9001-9004).
- Database servers get the database firewall (5432).

This assignment happens in the environment configurations when instantiating the server module. The firewall module just defines the rules; the server module references the firewall IDs.

### 4.2 Why separate firewalls instead of one big firewall

Separate firewalls allow you to apply least privilege by role. A gateway does not need validator P2P ports. A database does not need HTTP ports. Separate firewalls enforce this at the infrastructure layer.

This is a defense-in-depth pattern: even if an attacker compromises a service, the firewall limits lateral movement.

### 4.3 Admin IP allowlists

All firewalls allow SSH from admin IPs (`var.admin_ssh_ips`). This is a configurable variable set per environment. In production, this should be restricted to VPN endpoints or office IPs.

The firewall module does not hardcode IPs; it accepts them as input. This allows staging and production to use different admin IP ranges.

---

## 5) Server module: compute instances with cloud-init

The server module (`modules/server/main.tf`) creates Hetzner Cloud servers.

Key features:

- SSH key injection from Hetzner Cloud or inline public key.
- Cloud-init for initial setup (hostname, directory structure, service user).
- Firewall assignment via `firewall_ids`.
- Private network attachment with optional static IPs.
- Persistent volumes for stateful services (database, observability).
- Public IP control via `enable_public_ipv4`.

### 5.1 Instance count for horizontal scaling

The server module accepts `instance_count` to create multiple instances with the same configuration. This is used for gateways and validators.

For example, staging creates 2 gateways; production creates 4. The module names them `ns-gw-1`, `ns-gw-2`, etc.

### 5.2 Persistent volumes for stateful services

The module supports attaching persistent volumes (`hcloud_volume`) for databases and observability. Volumes are formatted as ext4 and mounted automatically.

This is critical for database persistence. If the server is destroyed and recreated, the volume can be reattached without data loss.

### 5.3 Cloud-init for base setup

Cloud-init runs on first boot to configure the server. The module uses a template (`templates/cloud-init.yaml.tpl`) to generate the cloud-init config.

Cloud-init typically:

- Sets the hostname.
- Creates the `nullspace` service user.
- Creates standard directories (`/opt/nullspace`, `/etc/nullspace`, `/var/lib/nullspace`).
- Installs base dependencies (Node, Rust, Docker).

This ensures all servers have a consistent baseline. After cloud-init completes, deployment scripts can assume the directory structure exists.

---

## 6) Load balancer module: L4 TCP and L7 HTTP

The load-balancer module (`modules/load-balancer/main.tf`) creates Hetzner load balancers.

Supported modes:

- **HTTP service**: L7 load balancing with health checks, sticky sessions, and optional HTTPS with certificate.
- **TCP service**: L4 load balancing for WebSocket gateways.

### 6.1 Gateway load balancer: TCP mode for WebSocket

The gateway load balancer uses TCP mode on port 9010. It forwards to backend gateways on the same port.

Health checks use HTTP on `/healthz` (even though the LB is TCP). This is a Hetzner-specific pattern: the LB can health-check HTTP while forwarding TCP.

### 6.2 Web load balancer: HTTP/HTTPS for website and auth

The web load balancer uses HTTP mode on port 80 (and optionally HTTPS on 443). It forwards to backend services on port 80.

Health checks use HTTP on `/healthz`. This ensures only healthy instances receive traffic.

### 6.3 Sticky sessions for stateful backends

The module supports sticky sessions via cookies (`SERVERID`). This is useful for auth or website if session state is not shared across instances.

For WebSocket gateways, sticky sessions are not needed because the gateway persists nonce state to disk.

### 6.4 Private IP targets

Load balancers can target servers via private IP (`use_private_ip = true`). This keeps backend traffic on the private network, even though the LB has a public IP.

This is the standard pattern for exposing private services via a public endpoint.

---

## 7) Staging vs production configurations

Staging and production environments differ in instance counts, instance sizes, and optional components.

### 7.1 Staging configuration (5k concurrent players)

From `environments/staging/main.tf`:

- **Gateways**: 2x CPX31 (4 vCPU, 8 GB).
- **Simulator**: 1x CPX41 (8 vCPU, 16 GB).
- **Validators**: 3x CPX31 (BFT quorum, f=1).
- **Auth**: 1x CPX21 (2 vCPU, 4 GB).
- **Database**: 1x CPX41 + 50 GB volume.
- **Observability**: Optional 1x CPX31 + volume.

Staging uses smaller instances and fewer gateways. Observability is optional.

### 7.2 Production configuration (20k+ concurrent players)

From `environments/production/main.tf`:

- **Gateways**: 4x CPX31 (double staging).
- **Simulator**: 1x CPX51 (16 vCPU, 32 GB, upgraded from staging).
- **Validators**: 4x CPX31 (BFT quorum, f=1).
- **Auth**: 1x CPX31 (upgraded from CPX21).
- **Database**: 1x CPX51 + 200 GB volume.
- **Convex**: Optional 1x CPX41 + volume (staging may skip this).
- **Observability**: 1x CPX41 + volume (upgraded from staging).

Production uses larger instances, more gateways, and always enables observability. It also creates a separate observability subnet.

### 7.3 Why staging and production share module code

Both environments use the same modules with different parameters. This ensures that staging tests the same infrastructure code that production will run.

If you change a module, you can test it in staging first. If it works, you can apply it to production with confidence.

### 7.4 Load balancer capacity differences

Staging uses `lb11` (5k connections/sec). Production uses `lb21` for the gateway LB (20k connections/sec).

This is a capacity scaling knob. Hetzner load balancers have different tiers based on throughput. Production pays for higher capacity.

---

## 8) S3-compatible state backend configuration

Terraform stores state in an S3-compatible backend. This allows multiple operators to share state and prevents concurrent modifications.

### 8.1 State file location

From `environments/staging/backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket = "nullspace-terraform-state"
    key    = "staging/terraform.tfstate"
    region = "us-east-1"
    encrypt = true
  }
}
```

State is stored at `s3://nullspace-terraform-state/staging/terraform.tfstate`.

Production uses `production/terraform.tfstate` in the same bucket.

### 8.2 S3-compatible backends: AWS, Hetzner, Cloudflare R2

Terraform's S3 backend supports any S3-compatible storage:

- **AWS S3**: Default, no extra config.
- **Hetzner Object Storage**: Set `endpoint = "https://fsn1.your-objectstorage.com"` and `skip_credentials_validation = true`.
- **Cloudflare R2**: Set `endpoint = "https://<account-id>.r2.cloudflarestorage.com"`.

The backend config files show commented-out options for non-AWS backends. Uncomment and set the endpoint based on your provider.

### 8.3 State locking with DynamoDB

For AWS backends, you can enable state locking with DynamoDB:

```hcl
dynamodb_table = "nullspace-terraform-locks"
```

This prevents concurrent `terraform apply` runs from corrupting state. For non-AWS backends, state locking is not supported. Use workspace isolation or coordination instead.

### 8.4 State encryption

`encrypt = true` enables server-side encryption for state files. This is important because state files contain resource IDs, IP addresses, and sometimes secrets.

Even though secrets should be managed via SOPS, state encryption is a defense-in-depth measure.

### 8.5 Backend initialization with credentials

When running `terraform init`, you must provide S3 credentials:

```bash
terraform init \
  -backend-config="access_key=$AWS_ACCESS_KEY_ID" \
  -backend-config="secret_key=$AWS_SECRET_ACCESS_KEY"
```

This is especially important in CI/CD pipelines where credentials are injected as secrets.

---

## 9) Integration with SOPS secrets management

Terraform provisions infrastructure, but it does not manage application secrets. Secrets are managed with SOPS (Secrets OPerationS) and Age encryption.

### 9.1 SOPS configuration

From `.sops.yaml`:

```yaml
creation_rules:
  - path_regex: secrets/staging/.*\.enc\.(yaml|json|env)$
    age: >-
      age1xaw2rdg74qg5qtxltsj9sjzul9uptelmuptge36xdz4d9x4r7q7qt6vn49
  - path_regex: secrets/production/.*\.enc\.(yaml|json|env)$
    age: >-
      age1production_key_placeholder_replace_with_actual_public_key
```

SOPS uses Age encryption keys to encrypt secrets files. Different environments use different keys for isolation.

### 9.2 Secrets directory structure

Secrets are stored per environment:

```
secrets/
├── staging/
│   ├── secrets.enc.yaml       # Encrypted secrets
│   └── README.md
├── production/
│   ├── secrets.enc.yaml
│   └── README.md
└── secrets.template.yaml      # Template for new environments
```

The `.enc.yaml` files are encrypted with SOPS. Plaintext secrets are never committed to git.

### 9.3 Decryption workflow

From `scripts/decrypt-secrets.sh`:

```bash
# Set Age private key
export SOPS_AGE_KEY="AGE-SECRET-KEY-..."

# Decrypt secrets and write to env files
./scripts/decrypt-secrets.sh staging /etc/nullspace
```

This decrypts `secrets/staging/secrets.enc.yaml` and generates service-specific env files:

- `auth.env`
- `convex.env`
- `gateway.env`
- `simulator.env`
- `ops.env`
- etc.

These env files are then sourced by systemd units or Docker Compose.

### 9.4 Why SOPS instead of Terraform secrets

Terraform can manage secrets via variables, but this has downsides:

- Secrets appear in Terraform state (even though state is encrypted).
- Secrets are harder to rotate without re-applying Terraform.
- Terraform state is infrastructure state, not application secrets.

SOPS keeps secrets separate from infrastructure. This allows you to rotate secrets without touching Terraform state.

### 9.5 CI/CD integration

In CI/CD pipelines (GitHub Actions), the SOPS Age key is stored as a repository secret:

```yaml
- name: Decrypt secrets
  env:
    SOPS_AGE_KEY: ${{ secrets.SOPS_AGE_KEY }}
  run: |
    ./scripts/decrypt-secrets.sh production /etc/nullspace
```

This allows automated deployments to decrypt secrets without storing plaintext credentials in CI config.

---

## 10) Deployment workflow and commands

The standard Terraform workflow is: init, plan, apply.

### 10.1 Staging deployment

```bash
cd terraform/environments/staging

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Set Hetzner token
export TF_VAR_hcloud_token="your-api-token"

# Initialize backend
terraform init

# Preview changes
terraform plan

# Apply changes
terraform apply
```

### 10.2 Production deployment with approval

Production deployments should use an approval workflow:

```bash
cd terraform/environments/production

# Initialize with backend credentials
terraform init \
  -backend-config="access_key=$AWS_ACCESS_KEY_ID" \
  -backend-config="secret_key=$AWS_SECRET_ACCESS_KEY"

# Plan and save to file
terraform plan -out=tfplan

# Review tfplan (manual step)

# Apply saved plan
terraform apply tfplan
```

Saving the plan to a file ensures that what you reviewed is what gets applied. This prevents TOCTOU (time-of-check-time-of-use) issues if resources change between plan and apply.

### 10.3 Outputs and DNS configuration

After apply, Terraform outputs essential information:

```bash
terraform output
terraform output gateway_lb_ip
terraform output dns_records
```

Outputs include:

- Load balancer public IPs.
- Server private IPs.
- DNS records to create (CNAME or A records).

These outputs are used to configure DNS and update deployment scripts.

### 10.4 Destroying infrastructure

To tear down staging (safe):

```bash
terraform destroy
```

To tear down production (requires confirmation):

```bash
# Destroy specific module first (safer)
terraform destroy -target=module.gateway

# Or destroy everything (dangerous)
terraform destroy
```

Production destroys should be rare and deliberate. Always back up state and volumes before destroying.

---

## 11) Post-provisioning steps

Terraform provisions infrastructure but does not deploy services. After `terraform apply`, you must:

1. **Configure SSH**: Add bastion host to `~/.ssh/config`.
2. **Deploy services**: Copy binaries and systemd units to servers.
3. **Distribute secrets**: Decrypt SOPS secrets to `/etc/nullspace/`.
4. **Run preflight**: `node scripts/preflight-management.mjs` to validate env files.
5. **Start services**: `systemctl start nullspace-*`.
6. **Validate readiness**: Follow `docs/testnet-readiness-runbook.md`.

This is the same workflow described in E14 (Hetzner runbook). Terraform is just the first step.

### 11.1 Why Terraform does not provision services

Terraform is designed for infrastructure resources (servers, networks, firewalls). It is not designed for application deployment.

Service deployment is handled by:

- Systemd units (E13).
- Docker Compose (E12).
- Manual deployment scripts.

This separation of concerns keeps Terraform code simple and focused.

---

## 12) Common pitfalls and how the modules avoid them

### 12.1 Missing firewall assignments

If you forget to assign a firewall to a server, it will accept all traffic. The server module requires `firewall_ids`, so you cannot create a server without a firewall.

### 12.2 Public IP leakage

If you accidentally set `enable_public_ipv4 = true` on internal services, they get public IPs. The modules default to `false` to prevent this.

### 12.3 State file conflicts

If multiple operators run `terraform apply` concurrently, they can corrupt state. Use state locking (DynamoDB) or coordinate manually.

### 12.4 Hardcoded values in modules

If you hardcode values in modules (like server types or instance counts), you lose reusability. The modules use variables for all configurable values.

### 12.5 Volume deletion on destroy

Persistent volumes are not deleted by default when servers are destroyed. This is a safety feature. If you want to delete volumes, you must explicitly target them:

```bash
terraform destroy -target=module.database.hcloud_volume.data
```

This prevents accidental data loss.

---

## 13) Feynman recap

Terraform modules encode the private network security model from E14 as declarative code. The network module creates a private CIDR; the firewall module defines least-privilege rules; the server module provisions instances with cloud-init; the load-balancer module exposes public endpoints while keeping backends private. Staging and production share module code but differ in instance counts and sizes. State is stored in S3-compatible backends for collaboration, and SOPS manages application secrets separately from infrastructure state. The workflow is init, plan, apply, then post-provision with secrets and services. Modularity allows testing in staging before applying to production.

Declarative infrastructure is reproducible infrastructure.

---

## 14) Limits and management callouts

### 14.1 Hetzner Cloud limits

Hetzner Cloud has per-project limits:

- **Servers**: 25 by default (request increase for production).
- **Volumes**: 100 per project.
- **Load balancers**: 5 per project.
- **Firewalls**: 10 per project.

If you hit limits, contact Hetzner support to request increases.

### 14.2 State backend reliability

State files are the source of truth for infrastructure. If you lose state, you lose the ability to manage resources with Terraform.

Always:

- Enable state file backups (S3 versioning or daily snapshots).
- Restrict access to the state bucket (only operators and CI/CD).
- Encrypt state at rest.

### 14.3 Terraform version pinning

The `versions.tf` file pins Terraform version to `>= 1.5.0`. This ensures compatibility but allows minor updates.

If you upgrade Terraform major versions, test in staging first. Terraform sometimes changes behavior across major versions.

### 14.4 Module versioning

The modules are local (not remote). This means changes to modules affect all environments immediately.

For production safety, consider:

- Moving modules to a separate git repository.
- Tagging module versions.
- Referencing modules by tag in environment configs.

This allows staging and production to use different module versions.

### 14.5 Cloud-init failures

Cloud-init runs on first boot. If it fails, the server may not have the expected directory structure or service user.

Check cloud-init logs:

```bash
ssh server
sudo journalctl -u cloud-init
```

If cloud-init fails, you must manually fix the server or destroy and recreate it.

### 14.6 SOPS key rotation

Age keys should be rotated periodically. To rotate:

1. Generate a new Age key.
2. Re-encrypt all secrets with the new key.
3. Update CI/CD secrets.
4. Revoke the old key.

This is a manual process. Plan for key rotation during low-traffic windows.

### 14.7 State drift detection

If someone manually modifies infrastructure (via Hetzner console), Terraform state will drift.

Detect drift:

```bash
terraform plan
```

If the plan shows unexpected changes, investigate before applying. Manual changes should be avoided; all changes should go through Terraform.

---

## 15) Exercises

1) Why are firewall rules separated by role instead of using one firewall for all servers?
2) What happens if you set `enable_public_ipv4 = true` on a database server?
3) Why does staging use CPX41 for the simulator but production uses CPX51?
4) How would you add a new environment (testnet) without duplicating module code?
5) Why are SOPS secrets managed separately from Terraform state?
6) What is the purpose of saving a Terraform plan to a file before applying in production?

---

## Next lesson

E27 - Observability stack: `feynman/lessons/E27-observability-stack.md` (or similar)
