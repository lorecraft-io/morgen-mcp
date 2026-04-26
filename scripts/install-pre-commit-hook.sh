#!/usr/bin/env bash
# install-pre-commit-hook.sh — wires up the local gitleaks pre-commit hook.
# Idempotent: safe to re-run.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK="$REPO_ROOT/.git/hooks/pre-commit"

if ! command -v gitleaks &>/dev/null; then
  echo "❌ gitleaks not found on PATH."
  echo "   macOS:  brew install gitleaks"
  echo "   Linux:  https://github.com/gitleaks/gitleaks/releases"
  exit 1
fi

mkdir -p "$REPO_ROOT/.git/hooks"
cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# pre-commit — gitleaks scan on staged content. Block if any secret detected.
# Bypass for emergencies: git commit --no-verify
set -euo pipefail

if ! command -v gitleaks &>/dev/null; then
  echo "⚠️  gitleaks missing — skipping pre-commit secret scan." >&2
  exit 0
fi

if ! gitleaks protect --staged --no-banner --redact -v 2>&1; then
  echo ""
  echo "🚨 SECRETS DETECTED in staged content. Commit BLOCKED." >&2
  echo "   1. Review the leak above (output is redacted — full content in your staged files)." >&2
  echo "   2. Remove the secret from your changes (use env vars / .env / secret manager)." >&2
  echo "   3. Re-stage cleaned files and commit again." >&2
  echo "   4. Emergency bypass (DO NOT USE FOR REAL SECRETS): git commit --no-verify" >&2
  exit 1
fi
HOOK_EOF
chmod +x "$HOOK"

echo "✅ Installed pre-commit hook → $HOOK"
echo "   Test it: stage a file containing a fake gho_/ntn_ token, then try git commit."
