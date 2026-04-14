#!/bin/bash
# ══════════════════════════════════════════════════════════
# CloudWatch Alarms for EMO Backend
# Run once after EC2 setup. Requires AWS CLI configured.
# Usage: bash cloudwatch-alarms.sh <instance-id> <sns-topic-arn>
# ══════════════════════════════════════════════════════════

INSTANCE_ID=${1:?"Usage: $0 <instance-id> <sns-topic-arn>"}
SNS_TOPIC=${2:?"Usage: $0 <instance-id> <sns-topic-arn>"}

echo "Setting up CloudWatch alarms for $INSTANCE_ID..."

# CPU > 80% for 5 minutes
aws cloudwatch put-metric-alarm \
  --alarm-name "emo-backend-high-cpu" \
  --alarm-description "Backend CPU > 80%" \
  --namespace "EMO/Backend" \
  --metric-name "cpu_usage_active" \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID \
  --statistic Average --period 300 --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 --treat-missing-data breaching \
  --alarm-actions $SNS_TOPIC

# Memory > 85%
aws cloudwatch put-metric-alarm \
  --alarm-name "emo-backend-high-memory" \
  --alarm-description "Backend Memory > 85%" \
  --namespace "EMO/Backend" \
  --metric-name "mem_used_percent" \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID \
  --statistic Average --period 300 --threshold 85 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 --treat-missing-data breaching \
  --alarm-actions $SNS_TOPIC

# Disk > 80%
aws cloudwatch put-metric-alarm \
  --alarm-name "emo-backend-disk-full" \
  --alarm-description "Disk usage > 80%" \
  --namespace "EMO/Backend" \
  --metric-name "disk_used_percent" \
  --dimensions Name=InstanceId,Value=$INSTANCE_ID Name=path,Value=/ \
  --statistic Average --period 300 --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 --treat-missing-data breaching \
  --alarm-actions $SNS_TOPIC

echo "Done. 3 alarms created → SNS topic: $SNS_TOPIC"
