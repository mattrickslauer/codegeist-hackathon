#!/usr/bin/env bash
# Deploy walkdown.mattrickslauer.com: stack, DNS, files, cache bust. Idempotent.
#   ./site/infra/deploy.sh
set -euo pipefail

STACK="${STACK:-walkdown-site}"
DOMAIN="${DOMAIN:-walkdown.mattrickslauer.com}"
ZONE_ID="${ZONE_ID:-Z090126035V1P4R9WWWU4}"   # mattrickslauer.com (Route 53, this account)
# Shared *.mattrickslauer.com certificate (also used by takes, transfer). Renews via DNS.
CERT_ARN="${CERT_ARN:-arn:aws:acm:us-east-1:821135790223:certificate/2c2f98a7-03be-4fe5-942f-8b25de810403}"
export AWS_DEFAULT_REGION=us-east-1

SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Deploying stack $STACK"
aws cloudformation deploy \
  --template-file "$SITE/infra/stack.yaml" \
  --stack-name "$STACK" \
  --no-fail-on-empty-changeset \
  --parameter-overrides "DomainName=${DOMAIN}" "CertificateArn=${CERT_ARN}"

out() { aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET="$(out SiteBucketName)"
DIST_ID="$(out DistributionId)"
DIST_DOMAIN="$(out DistributionDomain)"

# Only this subdomain's A/AAAA are upserted; nothing else in the zone is touched.
say "Pointing $DOMAIN at $DIST_DOMAIN"
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --change-batch "$(cat <<JSON
{"Comment":"walkdown subdomain","Changes":[
  {"Action":"UPSERT","ResourceRecordSet":{"Name":"${DOMAIN}","Type":"A",
    "AliasTarget":{"HostedZoneId":"Z2FDTNDATAQYW2","DNSName":"${DIST_DOMAIN}","EvaluateTargetHealth":false}}},
  {"Action":"UPSERT","ResourceRecordSet":{"Name":"${DOMAIN}","Type":"AAAA",
    "AliasTarget":{"HostedZoneId":"Z2FDTNDATAQYW2","DNSName":"${DIST_DOMAIN}","EvaluateTargetHealth":false}}}
]}
JSON
)" --query 'ChangeInfo.Status' --output text

say "Syncing $SITE/public to $BUCKET"
aws s3 sync "$SITE/public" "s3://$BUCKET" --delete --only-show-errors \
  --exclude "*.html" --cache-control "public, max-age=86400"
# HTML is never cached by browsers, so policy edits show up at once.
aws s3 sync "$SITE/public" "s3://$BUCKET" --delete --only-show-errors \
  --exclude "*" --include "*.html" \
  --content-type "text/html; charset=utf-8" --cache-control "public, max-age=0, must-revalidate"

say "Invalidating CloudFront"
INV="$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' \
  --query 'Invalidation.Id' --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INV"

say "Done: https://${DOMAIN}"
