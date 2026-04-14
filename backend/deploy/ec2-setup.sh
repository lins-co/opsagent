#!/bin/bash
# ══════════════════════════════════════════════════════════
# EMO Backend — EC2 First-Time Setup
# Run this ONCE on a fresh Ubuntu 22.04+ EC2 instance
# Usage: ssh ec2-user@<ip> 'bash -s' < ec2-setup.sh
# ══════════════════════════════════════════════════════════

set -euo pipefail

echo "── Installing Docker ──"
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

echo "── Installing Docker Compose plugin ──"
sudo apt-get update && sudo apt-get install -y docker-compose-plugin

echo "── Installing CloudWatch Agent ──"
wget -q https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i amazon-cloudwatch-agent.deb
rm amazon-cloudwatch-agent.deb

echo "── Creating app directory ──"
sudo mkdir -p /opt/emo
sudo chown $USER:$USER /opt/emo

echo "── Setting up CloudWatch config ──"
sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json > /dev/null <<'EOF'
{
  "agent": { "run_as_user": "root" },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/lib/docker/containers/*/*.log",
            "log_group_name": "emo-backend",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 14
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "EMO/Backend",
    "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
    "metrics_collected": {
      "cpu": { "measurement": ["usage_active"], "totalcpu": true },
      "mem": { "measurement": ["used_percent"] },
      "disk": { "measurement": ["used_percent"], "resources": ["/"]}
    }
  }
}
EOF

echo "── Starting CloudWatch Agent ──"
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

echo "
══════════════════════════════════════════════
  EC2 setup complete!

  Next steps:
  1. Log in to GHCR:
     echo \$GHCR_TOKEN | docker login ghcr.io -u <github-user> --password-stdin

  2. Copy docker-compose.yml to /opt/emo/
  3. Create /opt/emo/.env.production with your secrets
  4. Start:
     cd /opt/emo && docker compose up -d

  5. First run: check logs for WhatsApp QR code:
     docker logs -f emo-backend
══════════════════════════════════════════════
"
