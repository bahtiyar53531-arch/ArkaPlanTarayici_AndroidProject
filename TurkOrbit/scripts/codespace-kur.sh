#!/usr/bin/env bash
# Türk Orbit — Codespaces ilk kurulum (codespace oluşturulurken bir kez): bağımlılıklar.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "▶ Türk Orbit bağımlılıkları kuruluyor (birkaç dakika sürebilir)…"
npm ci --no-audit --no-fund
echo "✔ Bağımlılıklar kuruldu."
