#cloud-config
# Base server setup for Nullspace services
# Creates nullspace user, directories, and installs dependencies

hostname: ${hostname}

users:
  - name: nullspace
    groups: docker, sudo
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL

package_update: true
package_upgrade: true

packages:
  - docker.io
  - docker-compose-v2
  - htop
  - vim
  - curl
  - jq
  - unzip

runcmd:
  # Enable and start Docker
  - systemctl enable docker
  - systemctl start docker

  # Create Nullspace directories (per runbook Section 4)
  - mkdir -p /opt/nullspace
  - mkdir -p /etc/nullspace
  - mkdir -p /var/lib/nullspace
  - chown -R nullspace:nullspace /opt/nullspace /etc/nullspace /var/lib/nullspace

  # Tag this server
  - echo "PROJECT=${project_name}" >> /etc/nullspace/server.env
  - echo "ROLE=${role}" >> /etc/nullspace/server.env
  - echo "HOSTNAME=${hostname}" >> /etc/nullspace/server.env

  # Log completion
  - echo "Cloud-init completed for ${hostname} (${role})" | tee /var/log/nullspace-init.log

final_message: "Nullspace ${role} server ${hostname} ready after $UPTIME seconds"
