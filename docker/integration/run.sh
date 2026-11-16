#!/bin/sh
# Integration test runner: `make integration-test`.
#
# Starts the real stack in a throwaway Compose project, runs the tests in
# backend/tests_integration against it, and removes everything again. It does
# this twice, because the backend uses one login provider at a time:
#   1. with the test Keycloak (profile "keycloak")
#   2. with the test LDAP server (profile "ldap")
#
# The project name "pocket-it" keeps containers, network and volumes apart from
# a normal `docker compose up`, so a running development stack is not touched.

# Stop at the first failing command (-e) and on unset variables (-u).
set -eu

# Work from the repo root, wherever the script is started from.
cd "$(dirname "$0")/../.."

# --env-file /dev/null: ignore the developer's .env, so the test always runs
# with exactly the settings below.
compose() {
  docker compose --project-name pocket-it --env-file /dev/null "$@"
}

# Remove containers, network and volumes, also when a test fails or the script
# is interrupted. `trap ... EXIT` runs the function whenever the script ends.
cleanup() {
  echo "==> Removing the test stack"
  compose --profile keycloak --profile ldap --profile tools down --volumes --remove-orphans
}
trap cleanup EXIT

# Run the tests with one pytest marker inside the tools container. That
# container joins the project's network, so the tests reach the services by
# name (http://backend:8000). `-o addopts=` drops the quiet flag for readable output.
run_tests() {
  compose --profile tools run --rm -T tools \
    sh -c "cd backend && uv run pytest tests_integration -m $1 -o addopts= -v"
}

# Host ports away from the defaults, so nothing collides with a running stack.
export BACKEND_PORT=18000 WEB_PORT=13000 KEYCLOAK_PORT=18080

echo "==> Run 1 of 2: Keycloak"
# The issuer is the address Keycloak puts into its tokens (KC_HOSTNAME in
# docker-compose.yml); the keys are fetched over the internal network.
export POCKET_AUTH_PROVIDER=keycloak
export POCKET_OIDC_ISSUER="http://localhost:${KEYCLOAK_PORT}/realms/pocket"
export POCKET_OIDC_CLIENT_ID=project-pocket
export POCKET_OIDC_JWKS_URL=http://keycloak:8080/realms/pocket/protocol/openid-connect/certs
compose --profile keycloak up --detach --build --wait backend keycloak
run_tests keycloak

echo "==> Run 2 of 2: LDAP"
# Compose recreates the backend because its environment changed.
unset POCKET_OIDC_ISSUER POCKET_OIDC_CLIENT_ID POCKET_OIDC_JWKS_URL
export POCKET_AUTH_PROVIDER=ldap
export POCKET_LDAP_URL=ldap://ldap:3893
export POCKET_LDAP_BIND_DN="cn=pocket-service,ou=services,dc=pocket,dc=test"
export POCKET_LDAP_BIND_PASSWORD=pocket-service
export POCKET_LDAP_USER_BASE_DN="ou=people,dc=pocket,dc=test"
compose --profile ldap up --detach --wait backend ldap
run_tests ldap

echo "==> Integration tests passed"
