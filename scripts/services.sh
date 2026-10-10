#!/usr/bin/env bash

# Manage the complete local SketchTest development stack.
#
# Usage: ./scripts/services.sh {start|stop|restart|status}
#
# The database is a dedicated local Compose service. Application processes are
# started with their existing pnpm development commands and tracked by PID files.

set -uo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly STATE_DIR="$ROOT_DIR/.services"
readonly LOG_DIR="$ROOT_DIR/logs/services"
readonly DB_COMPOSE_FILE="$ROOT_DIR/scripts/services.compose.yaml"
readonly PORTS_FILE="$STATE_DIR/ports.env"
readonly START_TIMEOUT_SECONDS=60

if [[ -f "$ROOT_DIR/.env" ]]; then
  # Local development configuration is intentionally not committed. Shell-style
  # KEY=value entries are supported so the same file works with Docker Compose.
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

export POSTGRES_DB="${POSTGRES_DB:-sketchtest}"
export POSTGRES_USER="${POSTGRES_USER:-sketchtest}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-sketchtest}"

postgres_port_was_configured="${POSTGRES_PORT+x}"
fixture_port_was_configured="${FIXTURE_PORT+x}"
control_plane_port_was_configured="${CP_PORT+x}"
web_port_was_configured="${WEB_PORT+x}"

export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export FIXTURE_PORT="${FIXTURE_PORT:-3800}"
export CP_PORT="${CP_PORT:-3802}"
export WEB_PORT="${WEB_PORT:-5173}"

postgres_port_was_persisted=false
fixture_port_was_persisted=false
control_plane_port_was_persisted=false
web_port_was_persisted=false

load_persisted_ports() {
  [[ -f "$PORTS_FILE" ]] || return 0

  local name value
  while IFS='=' read -r name value; do
    [[ "$value" =~ ^[0-9]+$ ]] || continue
    case "$name" in
      POSTGRES_PORT)
        [[ "$postgres_port_was_configured" == x ]] || {
          export POSTGRES_PORT="$value"
          postgres_port_was_persisted=true
        }
        ;;
      FIXTURE_PORT)
        [[ "$fixture_port_was_configured" == x ]] || {
          export FIXTURE_PORT="$value"
          fixture_port_was_persisted=true
        }
        ;;
      CP_PORT)
        [[ "$control_plane_port_was_configured" == x ]] || {
          export CP_PORT="$value"
          control_plane_port_was_persisted=true
        }
        ;;
      WEB_PORT)
        [[ "$web_port_was_configured" == x ]] || {
          export WEB_PORT="$value"
          web_port_was_persisted=true
        }
        ;;
    esac
  done <"$PORTS_FILE"
}

mkdir -p "$STATE_DIR"
load_persisted_ports

port_is_in_use() {
  command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

select_port() {
  local label="$1"
  local variable_name="$2"
  local was_configured="$3"
  local was_persisted="$4"
  local requested_port="$5"
  local candidate="$requested_port"

  [[ "$was_persisted" == true ]] && return 0
  port_is_in_use "$candidate" || return 0
  if [[ "$was_configured" == x ]]; then
    printf '[FAIL] %s 端口 %s 已被占用；请设置一个可用的 %s。\n' \
      "$label" "$candidate" "$variable_name" >&2
    return 1
  fi

  while port_is_in_use "$candidate"; do
    ((candidate += 1))
  done
  printf -v "$variable_name" '%s' "$candidate"
  export "$variable_name"
  printf '[INFO] %s 默认端口 %s 已被占用；本次使用端口 %s。\n' \
    "$label" "$requested_port" "$candidate"
}

select_port 'PostgreSQL' POSTGRES_PORT "$postgres_port_was_configured" "$postgres_port_was_persisted" "$POSTGRES_PORT" || exit 1
select_port 'Fixture Server' FIXTURE_PORT "$fixture_port_was_configured" "$fixture_port_was_persisted" "$FIXTURE_PORT" || exit 1
select_port 'Control Plane' CP_PORT "$control_plane_port_was_configured" "$control_plane_port_was_persisted" "$CP_PORT" || exit 1
select_port 'Web' WEB_PORT "$web_port_was_configured" "$web_port_was_persisted" "$WEB_PORT" || exit 1

persist_ports() {
  printf 'POSTGRES_PORT=%s\nFIXTURE_PORT=%s\nCP_PORT=%s\nWEB_PORT=%s\n' \
    "$POSTGRES_PORT" "$FIXTURE_PORT" "$CP_PORT" "$WEB_PORT" >"$PORTS_FILE"
}

persist_ports

# This stack owns its database, so derive its connection string from the
# database settings. Set SKETCHTEST_DATABASE_URL to use another database.
export DATABASE_URL="${SKETCHTEST_DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}}"
export CP_URL="${SKETCHTEST_CP_URL:-http://127.0.0.1:${CP_PORT}}"
export VITE_CP_BASE="${SKETCHTEST_VITE_CP_BASE:-http://127.0.0.1:${CP_PORT}}"

RESET='\033[0m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'

if [[ ! -t 1 ]]; then
  RESET=''
  BLUE=''
  GREEN=''
  YELLOW=''
  RED=''
fi

readonly RESET BLUE GREEN YELLOW RED

DB_COMPOSE=(docker compose --project-name sketchtest-dev-services --file "$DB_COMPOSE_FILE")

info() {
  printf '%b[INFO]%b %s\n' "$BLUE" "$RESET" "$*"
}

success() {
  printf '%b[ OK ]%b %s\n' "$GREEN" "$RESET" "$*"
}

warn() {
  printf '%b[WARN]%b %s\n' "$YELLOW" "$RESET" "$*" >&2
}

error() {
  printf '%b[FAIL]%b %s\n' "$RED" "$RESET" "$*" >&2
}

usage() {
  cat <<'EOF'
Usage: ./scripts/services.sh <command>

Commands:
  start     Start PostgreSQL, Fixture Server, Control Plane, Runner, and Web.
  stop      Stop all managed application processes and PostgreSQL.
  restart   Stop and then start every service.
  status    Show the state of every managed service.

Configuration:
  Reads an optional .env file. PostgreSQL defaults to sketchtest/sketchtest on
  127.0.0.1:5432. If a default port is occupied, the script selects the next
  available port. Override POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, or
  POSTGRES_PORT as needed. Set SKETCHTEST_DATABASE_URL to use an external DB.

Logs: logs/services/<service>.log
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    error "缺少命令：$command_name"
    return 1
  fi
}

prepare_directories() {
  mkdir -p "$STATE_DIR" "$LOG_DIR"
}

pid_file() {
  printf '%s/%s.pid\n' "$STATE_DIR" "$1"
}

read_pid() {
  local file
  file="$(pid_file "$1")"
  [[ -f "$file" ]] || return 1

  local pid
  pid="$(<"$file")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$pid"
}

process_running() {
  local service="$1"
  local pid
  pid="$(read_pid "$service")" || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

remove_stale_pid_file() {
  local service="$1"
  local file
  file="$(pid_file "$service")"
  if [[ -f "$file" ]] && ! process_running "$service"; then
    rm -f "$file"
  fi
}

wait_for() {
  local description="$1"
  local check_function="$2"
  local timeout="${3:-$START_TIMEOUT_SECONDS}"
  local attempt=0

  while (( attempt < timeout )); do
    if "$check_function"; then
      return 0
    fi
    sleep 1
    ((attempt += 1))
  done

  error "$description 未在 ${timeout} 秒内就绪"
  return 1
}

database_ready() {
  "${DB_COMPOSE[@]}" exec -T postgres \
    pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1
}

fixture_ready() {
  curl --fail --silent --show-error "http://127.0.0.1:${FIXTURE_PORT}/health" >/dev/null 2>&1
}

control_plane_ready() {
  curl --fail --silent --show-error "http://127.0.0.1:${CP_PORT}/health" >/dev/null 2>&1
}

web_ready() {
  curl --fail --silent --show-error "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1
}

runner_ready() {
  local log_file="$LOG_DIR/runner.log"
  process_running runner && grep -Fq '[runner] Polling for work at' "$log_file" 2>/dev/null
}

start_database() {
  info '[1/5] 正在启动 PostgreSQL…'
  if ! "${DB_COMPOSE[@]}" up -d postgres >/dev/null; then
    error 'PostgreSQL 启动失败；请检查 Docker 是否运行以及端口是否可用'
    return 1
  fi
  wait_for 'PostgreSQL' database_ready 60
  success "[1/5] PostgreSQL 已就绪（127.0.0.1:${POSTGRES_PORT}）"
}

start_process() {
  local service="$1"
  shift
  local log_file="$LOG_DIR/${service}.log"
  local pid_path
  pid_path="$(pid_file "$service")"

  remove_stale_pid_file "$service"
  if process_running "$service"; then
    success "$service 已在运行（PID $(read_pid "$service")）"
    return 0
  fi

  : >"$log_file"
  (
    cd "$ROOT_DIR"
    nohup "$@" </dev/null >>"$log_file" 2>&1 &
    printf '%s\n' "$!" >"$pid_path"
  )
}

start_fixture() {
  info '[2/5] 正在启动 Fixture Server…'
  if process_running fixture && ! fixture_ready; then
    warn 'Fixture Server 的已跟踪进程未在当前端口就绪，正在重启'
    stop_process fixture
  fi
  start_process fixture pnpm dev:fixture
  wait_for 'Fixture Server' fixture_ready 30
  success "[2/5] Fixture Server 已就绪（http://127.0.0.1:${FIXTURE_PORT}）"
}

start_control_plane() {
  info '[3/5] 正在启动 Control Plane（迁移数据库）…'
  if process_running control-plane && ! control_plane_ready; then
    warn 'Control Plane 的已跟踪进程未在当前端口就绪，正在重启'
    stop_process control-plane
  fi
  start_process control-plane pnpm dev:cp
  wait_for 'Control Plane' control_plane_ready 60
  success "[3/5] Control Plane 已就绪（http://127.0.0.1:${CP_PORT}/health）"
}

start_runner() {
  local log_file="$LOG_DIR/runner.log"
  local pid_path
  pid_path="$(pid_file runner)"

  info '[4/5] 正在启动 Runner…'
  remove_stale_pid_file runner
  if ! process_running runner; then
    : >"$log_file"
    (
      cd "$ROOT_DIR"
      nohup bash -c '
        while true; do
          pnpm --filter runner exec tsx src/daemon.ts
          runner_exit_code=$?
          printf "[services] Runner exited (code %s); retrying in 5 seconds.\\n" "$runner_exit_code"
          sleep 5
        done
      ' </dev/null >>"$log_file" 2>&1 &
      printf '%s\n' "$!" >"$pid_path"
    )
  fi

  if wait_for_runner_registration; then
    success '[4/5] Runner 已注册并正在轮询任务'
  else
    warn '[4/5] Runner 进程已启动，正在等待工作区初始化或正确的 WORKSPACE_ID'
    warn "      查看日志：$log_file"
  fi
}

wait_for_runner_registration() {
  local attempt=0
  while (( attempt < 15 )); do
    runner_ready && return 0
    process_running runner || return 1
    sleep 1
    ((attempt += 1))
  done
  return 1
}

start_web() {
  info '[5/5] 正在启动 Web…'
  if process_running web && ! web_ready; then
    warn 'Web 的已跟踪进程未在当前端口就绪，正在重启'
    stop_process web
  fi
  start_process web pnpm --filter web dev --port "$WEB_PORT"
  wait_for 'Web' web_ready 30
  success "[5/5] Web 已就绪（http://127.0.0.1:${WEB_PORT}）"
}

children_of() {
  pgrep -P "$1" 2>/dev/null || true
}

terminate_tree() {
  local pid="$1"
  local child
  for child in $(children_of "$pid"); do
    terminate_tree "$child"
  done
  kill -TERM "$pid" >/dev/null 2>&1 || true
}

force_kill_tree() {
  local pid="$1"
  local child
  for child in $(children_of "$pid"); do
    force_kill_tree "$child"
  done
  kill -KILL "$pid" >/dev/null 2>&1 || true
}

stop_process() {
  local service="$1"
  local pid
  pid="$(read_pid "$service")" || {
    success "$service 未运行"
    return 0
  }

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$(pid_file "$service")"
    success "$service 未运行"
    return 0
  fi

  info "正在停止 ${service}（PID ${pid}）…"
  terminate_tree "$pid"

  local attempt=0
  while kill -0 "$pid" >/dev/null 2>&1 && (( attempt < 10 )); do
    sleep 1
    ((attempt += 1))
  done

  if kill -0 "$pid" >/dev/null 2>&1; then
    warn "$service 未在 10 秒内退出，正在强制停止"
    force_kill_tree "$pid"
  fi

  rm -f "$(pid_file "$service")"
  success "$service 已停止"
}

stop_database() {
  local database_id
  database_id="$("${DB_COMPOSE[@]}" ps -q postgres 2>/dev/null || true)"
  if [[ -z "$database_id" ]]; then
    success 'PostgreSQL 未运行'
    return 0
  fi

  info '正在停止 PostgreSQL…'
  "${DB_COMPOSE[@]}" stop postgres >/dev/null
  success 'PostgreSQL 已停止（数据卷已保留）'
}

status_process() {
  local label="$1"
  local service="$2"
  local check_function="$3"
  local pid
  pid="$(read_pid "$service")" || {
    printf '%-18s %s\n' "$label" '未运行'
    return
  }

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$(pid_file "$service")"
    printf '%-18s %s\n' "$label" '已停止（已清理失效 PID）'
  elif "$check_function"; then
    printf '%-18s 运行中（PID %s，已就绪）\n' "$label" "$pid"
  else
    printf '%-18s 运行中（PID %s，等待就绪）\n' "$label" "$pid"
  fi
}

show_status() {
  prepare_directories
  printf '%s\n' 'SketchTest 本地服务状态'
  printf '%s\n' '────────────────────────────────────────'

  if database_ready; then
    printf '%-18s 运行中（已就绪，127.0.0.1:%s）\n' 'PostgreSQL' "$POSTGRES_PORT"
  else
    printf '%-18s %s\n' 'PostgreSQL' '未运行或未就绪'
  fi
  status_process 'Fixture Server' fixture fixture_ready
  status_process 'Control Plane' control-plane control_plane_ready
  status_process 'Runner' runner runner_ready
  status_process 'Web' web web_ready
  printf '\n日志目录：%s\n' "$LOG_DIR"
}

start_all() {
  prepare_directories
  require_command docker
  require_command pnpm
  require_command curl
  require_command pgrep
  printf '%s\n' '开始启动 SketchTest 本地服务…'

  start_database || return 1
  start_fixture || return 1
  start_control_plane || return 1
  start_runner
  start_web || return 1

  printf '\n'
  success '本地服务启动流程完成'
  show_status
  printf '\n访问地址：\n'
  printf '  前端： http://127.0.0.1:%s\n' "$WEB_PORT"
  printf '  API：  http://127.0.0.1:%s\n' "$CP_PORT"
  printf '  健康： http://127.0.0.1:%s/health\n' "$CP_PORT"
}

stop_all() {
  prepare_directories
  printf '%s\n' '正在停止 SketchTest 本地服务…'
  stop_process web
  stop_process runner
  stop_process control-plane
  stop_process fixture
  stop_database
}

main() {
  case "${1:-}" in
    start)
      start_all
      ;;
    stop)
      stop_all
      ;;
    restart)
      stop_all
      start_all
      ;;
    status)
      show_status
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage >&2
      return 1
      ;;
  esac
}

main "$@"
