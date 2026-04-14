#!/bin/bash
# ============================================================
# MORGEN MCP — INSTALLER
# ============================================================
# Installs morgen-mcp as a Claude Code MCP server,
# collects credentials, writes .env, and verifies the setup.
#
# USAGE:
#   curl -fsSL <raw-url> | bash
#   — or —
#   chmod +x install.sh && ./install.sh
#
# IDEMPOTENT: Safe to re-run. Detects existing installs and
# prompts before overwriting.
# ============================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Output helpers ──────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC}    $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}    $1"; }
fail()    { echo -e "${RED}[FAIL]${NC}    $1"; exit 1; }
step()    { echo -e "\n${CYAN}${BOLD}── Step $1: $2 ──${NC}"; }

# ── Config ──────────────────────────────────────────────────
ENV_DIR="$HOME/.morgen-mcp"
ENV_FILE="$ENV_DIR/.env"
MCP_NAME="morgen"
NPX_CMD="npx -y morgen-mcp"

# ── Banner ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   ${CYAN}Morgen MCP${NC}${BOLD} — Installer                             ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo -e "  ${DIM}Morgen calendar & task access for Claude Code${NC}"
echo ""

# ============================================================
# STEP 1: Check prerequisites
# ============================================================
step "1" "Checking prerequisites"

# -- Node.js --
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  success "Node.js found: $NODE_VERSION"

  # Check minimum version (20+)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 20 ]; then
    fail "Node.js 20+ required (found $NODE_VERSION). Update at https://nodejs.org"
  fi
else
  fail "Node.js not found. Install it from https://nodejs.org (v20+ required)"
fi

# -- npm --
if command -v npm &>/dev/null; then
  NPM_VERSION=$(npm --version)
  success "npm found: v$NPM_VERSION"
else
  fail "npm not found. It should come with Node.js — reinstall from https://nodejs.org"
fi

# -- npx --
if command -v npx &>/dev/null; then
  success "npx found"
else
  fail "npx not found. It should come with npm — try: npm install -g npx"
fi

# -- Claude Code --
if command -v claude &>/dev/null; then
  success "Claude Code CLI found"
else
  warn "Claude Code CLI not found in PATH"
  echo -e "  ${DIM}Install it from: https://docs.anthropic.com/en/docs/claude-code${NC}"
  echo -e "  ${DIM}If it's installed but not in PATH, you can continue — the MCP will${NC}"
  echo -e "  ${DIM}still work if you add it manually to your Claude config.${NC}"
  echo ""
  read -p "Continue anyway? (y/N): " CONTINUE_ANYWAY
  if [[ ! "$CONTINUE_ANYWAY" =~ ^[Yy]$ ]]; then
    echo ""
    info "Install Claude Code first, then re-run this script."
    exit 0
  fi
fi

# ============================================================
# STEP 2: Check for existing installation
# ============================================================
step "2" "Checking for existing installation"

ALREADY_INSTALLED=false

if [ -f "$ENV_FILE" ]; then
  ALREADY_INSTALLED=true
  warn "Existing installation detected at $ENV_DIR"
  echo ""
  read -p "Overwrite existing configuration? (y/N): " OVERWRITE
  if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
    echo ""
    info "Keeping existing configuration. Skipping to verification..."
    # Jump ahead — skip credential collection and MCP registration
    SKIP_SETUP=true
  else
    SKIP_SETUP=false
  fi
else
  SKIP_SETUP=false
  info "No existing installation found. Starting fresh setup."
fi

# ============================================================
# STEP 3: Register MCP with Claude Code
# ============================================================
step "3" "Registering MCP with Claude Code"

if command -v claude &>/dev/null; then
  # Check if already registered
  MCP_EXISTS=$(claude mcp list 2>/dev/null | grep -c "$MCP_NAME" || true)

  if [ "$MCP_EXISTS" -gt 0 ] && [ "$SKIP_SETUP" = true ]; then
    success "MCP already registered: $MCP_NAME"
  else
    info "Registering MCP server: $MCP_NAME"
    if claude mcp add --scope user "$MCP_NAME" -- $NPX_CMD 2>/dev/null; then
      success "MCP registered: $MCP_NAME"
    else
      warn "MCP registration returned non-zero — it may already exist."
      info "You can verify with: claude mcp list"
    fi
  fi
else
  warn "Skipping MCP registration (Claude CLI not available)"
  echo -e "  ${DIM}Run this manually later:${NC}"
  echo -e "  ${DIM}  claude mcp add --scope user $MCP_NAME -- $NPX_CMD${NC}"
fi

# ============================================================
# STEP 4: Collect credentials (unless skipping)
# ============================================================
if [ "$SKIP_SETUP" = false ]; then

step "4" "Collecting credentials"

echo ""
echo -e "${BOLD}You'll need 1 credential from Morgen.${NC}"
echo -e "${DIM}Follow the instructions below to find it.${NC}"
echo ""

# -- Morgen API Key --
echo -e "${YELLOW}1. Morgen API Key${NC}"
echo -e "   ${DIM}Get this from: https://platform.morgen.so/developers-api${NC}"
echo -e "   ${DIM}(Sign in to Morgen, then create a developer API key)${NC}"
echo ""
read -sp "   Enter your Morgen API key: " MORGEN_API_KEY
echo -e " ${GREEN}[saved]${NC}"
echo ""

if [ -z "$MORGEN_API_KEY" ]; then
  fail "Morgen API key is required."
fi

# -- Timezone --
echo -e "${YELLOW}2. Timezone (optional)${NC}"
DETECTED_TZ=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || echo "")
if [ -n "$DETECTED_TZ" ]; then
  echo -e "   ${DIM}Detected system timezone: $DETECTED_TZ${NC}"
  DEFAULT_TZ="$DETECTED_TZ"
else
  DEFAULT_TZ="America/New_York"
fi
echo -e "   ${DIM}Default: $DEFAULT_TZ${NC}"
echo ""
read -p "   Enter your timezone [$DEFAULT_TZ]: " MORGEN_TIMEZONE
MORGEN_TIMEZONE="${MORGEN_TIMEZONE:-$DEFAULT_TZ}"
echo ""

# ============================================================
# STEP 5: Write .env file
# ============================================================
step "5" "Writing configuration"

mkdir -p "$ENV_DIR"

cat > "$ENV_FILE" << ENVEOF
# Morgen MCP Configuration
# Generated by install.sh on $(date '+%Y-%m-%d %H:%M:%S')
# Location: $ENV_FILE

MORGEN_API_KEY=$MORGEN_API_KEY
MORGEN_TIMEZONE=$MORGEN_TIMEZONE
ENVEOF

chmod 600 "$ENV_FILE"
success "Configuration written to: $ENV_FILE"
success "File permissions set to 600 (owner read/write only)"

# ============================================================
# STEP 6: Update MCP config to use .env location
# ============================================================
step "6" "Configuring MCP environment"

if command -v claude &>/dev/null; then
  # Remove and re-add with env file path
  claude mcp remove "$MCP_NAME" --scope user 2>/dev/null || true
  if claude mcp add --scope user "$MCP_NAME" \
    -e "DOTENV_CONFIG_PATH=$ENV_FILE" \
    -- $NPX_CMD 2>/dev/null; then
    success "MCP configured with .env path"
  else
    warn "Could not update MCP config with env path."
    echo -e "  ${DIM}The MCP server will look for .env in its package directory by default.${NC}"
    echo -e "  ${DIM}You may need to set DOTENV_CONFIG_PATH=$ENV_FILE manually.${NC}"
  fi
fi

else
  # SKIP_SETUP=true — we skipped credential collection
  info "Skipped credential collection (using existing config)"
fi

# ============================================================
# STEP 7: Verification
# ============================================================
step "7" "Verifying installation"

VERIFY_PASSED=true

# Check .env exists and is readable
if [ -f "$ENV_FILE" ]; then
  success ".env file exists at $ENV_FILE"
else
  warn ".env file not found — configuration may be incomplete"
  VERIFY_PASSED=false
fi

# Check .env has all required keys
if [ -f "$ENV_FILE" ]; then
  MISSING_KEYS=()
  for KEY in MORGEN_API_KEY; do
    if ! grep -q "^${KEY}=.\+" "$ENV_FILE" 2>/dev/null; then
      MISSING_KEYS+=("$KEY")
    fi
  done

  if [ ${#MISSING_KEYS[@]} -eq 0 ]; then
    success "All required credentials present in .env"
  else
    warn "Missing credentials: ${MISSING_KEYS[*]}"
    VERIFY_PASSED=false
  fi
fi

# Check MCP registration
if command -v claude &>/dev/null; then
  MCP_COUNT=$(claude mcp list 2>/dev/null | grep -c "$MCP_NAME" || true)
  if [ "$MCP_COUNT" -gt 0 ]; then
    success "MCP server registered in Claude Code"
  else
    warn "MCP server not found in Claude Code config"
    VERIFY_PASSED=false
  fi
fi

# Quick API test — hit Morgen calendars list to validate the API key
if [ -f "$ENV_FILE" ]; then
  info "Testing API credentials (calendars list)..."

  # Source the env file to get values
  source "$ENV_FILE"

  CAL_RESPONSE=$(curl -s -w "\n%{http_code}" \
    "https://api.morgen.so/v3/calendars/list" \
    -H "Authorization: ApiKey $MORGEN_API_KEY" \
    -H "Accept: application/json" \
    2>/dev/null || echo "000")

  HTTP_CODE=$(echo "$CAL_RESPONSE" | tail -1)

  if [ "$HTTP_CODE" = "200" ]; then
    success "Morgen API access confirmed — credentials are valid"
  elif [ "$HTTP_CODE" = "401" ]; then
    warn "Morgen API returned HTTP 401 — invalid API key"
    VERIFY_PASSED=false
  elif [ "$HTTP_CODE" = "403" ]; then
    warn "Morgen API returned HTTP 403 — check permissions on your API key"
    VERIFY_PASSED=false
  elif [ "$HTTP_CODE" = "000" ]; then
    warn "Could not reach Morgen API — check your internet connection"
    VERIFY_PASSED=false
  else
    warn "Morgen API returned HTTP $HTTP_CODE"
    VERIFY_PASSED=false
  fi
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
if [ "$VERIFY_PASSED" = true ]; then
echo -e "${BOLD}║   ${GREEN}Installation Complete${NC}${BOLD}                              ║${NC}"
else
echo -e "${BOLD}║   ${YELLOW}Installation Complete (with warnings)${NC}${BOLD}              ║${NC}"
fi
echo -e "${BOLD}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║${NC}                                                      ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  MCP Name:    ${CYAN}$MCP_NAME${NC}                                  ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  Config:      ${DIM}$ENV_FILE${NC}        ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  Command:     ${DIM}$NPX_CMD${NC}                  ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}                                                      ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}  ${DIM}Restart Claude Code for the MCP to take effect.${NC}     ${BOLD}║${NC}"
echo -e "${BOLD}║${NC}                                                      ${BOLD}║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$VERIFY_PASSED" = false ]; then
  echo -e "${YELLOW}Some checks failed. Review the warnings above.${NC}"
  echo -e "${DIM}You can re-run this script at any time to reconfigure.${NC}"
  echo ""
fi

echo -e "${DIM}Troubleshooting:${NC}"
echo -e "${DIM}  - Re-run this script to reconfigure credentials${NC}"
echo -e "${DIM}  - Check MCP status:  claude mcp list${NC}"
echo -e "${DIM}  - View config:       cat $ENV_FILE${NC}"
echo -e "${DIM}  - Remove MCP:        claude mcp remove $MCP_NAME --scope user${NC}"
echo ""
