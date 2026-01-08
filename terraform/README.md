# Nullspace Infrastructure as Code

Terraform modules for provisioning Nullspace infrastructure on Hetzner Cloud.

## Architecture

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

## Prerequisites

1. **Terraform**: Install Terraform >= 1.5.0
   ```bash
   # macOS
   brew install terraform

   # Linux
   curl -fsSL https://releases.hashicorp.com/terraform/1.7.0/terraform_1.7.0_linux_amd64.zip -o tf.zip
   unzip tf.zip && sudo mv terraform /usr/local/bin/
   ```

2. **Hetzner Cloud Account**: Create API token at https://console.hetzner.cloud/projects

3. **SSH Key**: Upload SSH key to Hetzner Cloud console

4. **State Backend**: Create S3 bucket for Terraform state
   ```bash
   # AWS S3
   aws s3 mb s3://nullspace-terraform-state --region us-east-1

   # Or use Hetzner Object Storage / Cloudflare R2
   ```

## Quick Start

### Staging Environment

```bash
cd terraform/environments/staging

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Set Hetzner token
export TF_VAR_hcloud_token="your-api-token"

# Initialize and apply
terraform init
terraform plan
terraform apply
```

### Production Environment

```bash
cd terraform/environments/production

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars

# Initialize with backend config
terraform init \
  -backend-config="access_key=$AWS_ACCESS_KEY_ID" \
  -backend-config="secret_key=$AWS_SECRET_ACCESS_KEY"

# Plan and apply with approval
terraform plan -out=tfplan
terraform apply tfplan
```

## Server Specifications

Based on `docs/hetzner-deployment-runbook.md`:

| Component     | Staging        | Production     | Notes                    |
|---------------|----------------|----------------|--------------------------|
| Gateway       | 2x CPX31       | 4x CPX31       | Horizontal scaling       |
| Simulator     | 1x CPX41       | 1x CPX51       | Single instance, scale up|
| Validators    | 3x CPX31       | 4x CPX31       | BFT quorum (f=1)         |
| Auth          | 1x CPX21       | 1x CPX31       | Stateless               |
| Database      | 1x CPX41 +50GB | 1x CPX51 +200GB| Persistent volume       |
| Observability | 1x CPX31       | 1x CPX41       | Prometheus/Grafana/Loki  |

## Network Topology

- **CIDR**: `10.0.0.0/16`
- **Services Subnet**: `10.0.1.0/24`
- **Observability Subnet**: `10.0.2.0/24` (production only)

All servers use private IPs except load balancers which have public IPs.

## Firewall Rules

See `modules/firewall/main.tf` for detailed rules. Summary:

| Firewall      | Ports                           | Source           |
|---------------|---------------------------------|------------------|
| bastion       | 22/tcp                          | Admin IPs        |
| web           | 80/tcp, 443/tcp, 22/tcp         | Public, Admin    |
| internal      | 8080, 9010, 4000, 9020          | Private network  |
| validator     | 9001-9004, 9100-9104            | Private, Prometheus |
| database      | 5432                            | Private network  |
| observability | 9090, 3000-3001, 3100, 4317-4318| Admin, Private   |

## State Management

Terraform state is stored in S3-compatible storage:

- **Staging**: `s3://nullspace-terraform-state/staging/terraform.tfstate`
- **Production**: `s3://nullspace-terraform-state/production/terraform.tfstate`

For state locking with AWS DynamoDB:
```hcl
# Uncomment in backend.tf
dynamodb_table = "nullspace-terraform-locks"
```

## Post-Provisioning

After `terraform apply`:

1. **Configure SSH**: Add bastion host to `~/.ssh/config`
2. **Deploy services**: Use systemd units from `ops/systemd/`
3. **Distribute configs**: Copy env files to `/etc/nullspace/`
4. **Run preflight**: `node scripts/preflight-management.mjs`
5. **Validate**: Follow `docs/testnet-readiness-runbook.md`

## Outputs

After apply, Terraform outputs essential information:

```bash
terraform output

# Get specific output
terraform output gateway_lb_ip
terraform output dns_records
```

## Destroying Infrastructure

```bash
# Staging (safe to destroy)
terraform destroy

# Production (requires confirmation)
terraform destroy -target=module.gateway  # Destroy specific module
```

## Troubleshooting

### Provider Authentication
```bash
# Verify Hetzner token
export TF_VAR_hcloud_token="your-token"
hcloud server list  # Test with CLI
```

### State Locking
```bash
# Force unlock (use with caution)
terraform force-unlock <lock-id>
```

### Module Debugging
```bash
terraform plan -target=module.network
terraform apply -target=module.firewall
```

## Security Notes

1. **Never commit `terraform.tfvars`** - it contains sensitive tokens
2. **Rotate API tokens** regularly
3. **Restrict admin IPs** to VPN/bastion only in production
4. **Enable state encryption** in backend configuration
5. **Use workspaces** for environment isolation if not using separate directories

## Related Documentation

- `docs/hetzner-deployment-runbook.md` - Manual deployment steps
- `docs/resource_sizing.md` - Capacity planning
- `docs/testnet-readiness-runbook.md` - Validation checklist
- `ops/systemd/` - Service unit files
