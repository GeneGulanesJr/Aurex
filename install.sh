#!/usr/bin/env bash
set -e

echo "📦 Installing LaPis — Persistent memory for Pi..."

if command -v pi &>/dev/null; then
    pi install git:github.com/GeneGulanesJr/LaPis
    echo ""
    echo "✅ LaPis installed. Restart Pi to activate."
    echo "   Use 'pi update --extensions' to keep it up to date."
else
    echo "❌ 'pi' command not found. Install Pi first:"
    echo "   See https://github.com/earendil-works/pi-coding-agent"
    exit 1
fi
