#!/usr/bin/env bash
# Sobe um Supabase mínimo local (Postgres + Auth + REST + e-mail de teste) para testar o Easy Cut.
# Uso: dev/stack.sh up | down | reset   (depois: node dev/proxy.mjs e npm run dev)
set -euo pipefail
cd "$(dirname "$0")"
source ./local.env
NET=easycut-net
PW=postgres

down() {
  docker rm -f ec-db ec-auth ec-rest ec-mail >/dev/null 2>&1 || true
  docker network rm $NET >/dev/null 2>&1 || true
}

up() {
  docker network create $NET >/dev/null 2>&1 || true
  docker run -d --name ec-db --network $NET -p 54322:5432 \
    -e POSTGRES_PASSWORD=$PW -e JWT_SECRET="$JWT_SECRET" -e JWT_EXP=3600 \
    supabase/postgres:17.6.1.029 postgres -c config_file=/etc/postgresql/postgresql.conf >/dev/null
  echo -n "db"
  for i in $(seq 1 90); do
    if docker exec ec-db pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
    sleep 1; echo -n "."
  done
  sleep 3
  for i in $(seq 1 30); do
    if docker exec -e PGPASSWORD=$PW ec-db psql -h 127.0.0.1 -U supabase_admin -d postgres -tAc "select 1 from pg_roles where rolname='supabase_auth_admin'" 2>/dev/null | grep -q 1; then break; fi
    sleep 1; echo -n "+"
  done
  echo " ok"
  docker exec -e PGPASSWORD=$PW ec-db psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q -c "
    alter role authenticator with password '$PW';
    alter role supabase_auth_admin with password '$PW';
    alter role supabase_storage_admin with password '$PW';
    alter role postgres with password '$PW';
  "
  docker run -d --name ec-mail --network $NET -p 54324:8025 \
    -e MP_SMTP_BIND_ADDR=0.0.0.0:1025 -e MP_UI_BIND_ADDR=0.0.0.0:8025 axllent/mailpit:v1.27 >/dev/null
  docker run -d --name ec-auth --network $NET -p 54329:9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321 \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PW@ec-db:5432/postgres" \
    -e GOTRUE_SITE_URL=http://127.0.0.1:5173 \
    -e GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:5173/**,http://localhost:5173/**,http://127.0.0.1:4173/**" \
    -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated \
    -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_SECRET="$JWT_SECRET" \
    -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
    -e GOTRUE_SMTP_HOST=ec-mail -e GOTRUE_SMTP_PORT=1025 -e GOTRUE_SMTP_ADMIN_EMAIL=nao-responda@easycut.local \
    -e GOTRUE_SMTP_SENDER_NAME="Easy Cut" -e GOTRUE_SMTP_USER= -e GOTRUE_SMTP_PASS= \
    -e GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify \
    -e GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify \
    -e GOTRUE_EXTERNAL_PHONE_ENABLED=false -e GOTRUE_RATE_LIMIT_EMAIL_SENT=100 \
    -e GOTRUE_PASSWORD_MIN_LENGTH=6 \
    supabase/gotrue:v2.180.0 >/dev/null
  docker run -d --name ec-rest --network $NET -p 54330:3000 \
    -e PGRST_DB_URI="postgres://authenticator:$PW@ec-db:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public,graphql_public -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions \
    -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_DB_USE_LEGACY_GUCS=false \
    -e PGRST_DB_MAX_ROWS=1000 \
    postgrest/postgrest:v13.0.7 >/dev/null
  echo -n "auth"
  for i in $(seq 1 60); do
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:54329/health | grep -q 200; then break; fi
    sleep 1; echo -n "."
  done
  echo " ok"
}

# Cria as tabelas e funções (o mesmo SQL do Supabase de verdade) e coloca os dados de exemplo.
schema() {
  docker exec -i -e PGPASSWORD=$PW ec-db psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    < ../supabase/migrations/20261110000000_easycut.sql
  docker exec -i -e PGPASSWORD=$PW ec-db psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q < ../supabase/seed.sql
  docker exec -e PGPASSWORD=$PW ec-db psql -h 127.0.0.1 -U postgres -d postgres -q -c "notify pgrst, 'reload schema'"
  echo "banco ok"
}

case "${1:-up}" in
  up) up; schema ;;
  down) down ;;
  reset) down; up; schema ;;
esac
