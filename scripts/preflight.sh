#!/usr/bin/env bash
# 启动前检查：colab CLI / 认证 / MySQL / 密钥
set -u
cd "$(dirname "$0")/.."

ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✘\033[0m %s\033[0m\n" "$1"; FAIL=1; }
info() { printf "  \033[36mℹ\033[0m %s\n" "$1"; }

FAIL=0
echo "== Colab Download Manager preflight =="

# .env
if [ -f .env ]; then ok ".env 存在"; else bad ".env 缺失（从 .env.example 复制）"; fi
set -a; [ -f .env ] && . ./.env; set +a

# colab CLI
COLAB_BIN="${NUXT_COLAB_BIN:-colab}"
if command -v "$COLAB_BIN" >/dev/null 2>&1; then
  ok "colab CLI 可执行: $(command -v "$COLAB_BIN")"
else
  bad "colab CLI 未找到（pip install google-colab-cli，或 CDM_MOCK=1）"
fi

# MySQL
DB_HOST="${NUXT_DB_HOST:-127.0.0.1}"; DB_PORT="${NUXT_DB_PORT:-3306}"
DB_USER="${NUXT_DB_USER:-root}";    DB_NAME="${NUXT_DB_NAME:-colab_down}"
if command -v mysql >/dev/null 2>&1; then
  if mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${NUXT_DB_PASSWORD:+-p"$NUXT_DB_PASSWORD"} \
      -e "SELECT 1" >/dev/null 2>&1; then
    ok "MySQL $DB_HOST:$DB_PORT 可连接"
    if mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${NUXT_DB_PASSWORD:+-p"$NUXT_DB_PASSWORD"} \
        -e "USE $DB_NAME" >/dev/null 2>&1; then
      ok "数据库 $DB_NAME 存在"
    else
      bad "数据库 $DB_NAME 不存在（CREATE DATABASE $DB_NAME CHARACTER SET utf8mb4）"
    fi
  else
    bad "MySQL $DB_HOST:$DB_PORT 连接失败"
  fi
else
  info "未安装 mysql 客户端，跳过连接检查"
fi

# 密钥
if [ -n "${NUXT_CDM_SECRET_KEY:-}" ]; then ok "NUXT_CDM_SECRET_KEY 已设置"; else bad "NUXT_CDM_SECRET_KEY 未设置"; fi

# Mock 提示
if [ "${NUXT_CDM_MOCK:-0}" = "1" ]; then info "CDM_MOCK=1：使用 MockColabBridge，不调用真实 Colab"; fi

if [ "$FAIL" = "0" ]; then echo "== 全部通过 =="; else echo "== 存在失败项 =="; exit 1; fi
