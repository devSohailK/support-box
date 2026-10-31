#!/usr/bin/env bash
# Runs ON the EC2 instance (copied there by the GitHub Actions deploy job).
# Pulls the images for IMAGE_TAG, restarts the stack, and waits for the API health check.
#
#   IMAGE_TAG=<git sha> ./deploy.sh      # deploy (or roll back to) a specific build
set -euo pipefail

cd "$(dirname "$0")"
: "${IMAGE_TAG:?IMAGE_TAG is required (a git commit sha or 'latest')}"
export IMAGE_TAG

if [ ! -f .env ]; then
  echo "Missing $(pwd)/.env. Create it from .env.example before the first deploy." >&2
  exit 1
fi

compose() { docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"; }

echo "Deploying ${IMAGE_TAG}"
compose pull app web
compose up -d --no-build --remove-orphans app web mailpit

echo "Waiting for the API to report healthy"
for _ in $(seq 1 30); do
  if compose exec -T app node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "Healthy: ${IMAGE_TAG} is live"
    echo "${IMAGE_TAG}" > .deployed-tag
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done

echo "Health check failed. Recent app logs:" >&2
compose logs --tail 50 app >&2
exit 1
