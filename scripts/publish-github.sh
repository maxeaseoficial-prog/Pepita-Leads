#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-Pepita}"
OWNER="${2:-maxeaseoficial-prog}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) não está instalado."
  echo "Instale em https://cli.github.com/ e faça: gh auth login"
  exit 1
fi

git init
git add .
git commit -m "feat: Pepita SaaS v1.0.0"
git branch -M main

gh repo create "$OWNER/$REPO_NAME" --private --source=. --remote=origin --push

echo "Repositório criado: https://github.com/$OWNER/$REPO_NAME"
