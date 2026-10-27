#!/bin/zsh
set -e
cd -- "${0:A:h}"
node_compatible() {
  command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a<22||(a===22&&b<12)?1:0)'
}
if ! node_compatible && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
  for candidate in 24 22; do
    if nvm use --silent "$candidate" >/dev/null 2>&1 && node_compatible; then
      break
    fi
  done
fi
if ! node_compatible; then
  print -u2 'Node.js 22.12 이상을 설치하거나 활성화하세요. Node.js 24 LTS를 권장합니다.'
  exit 1
fi
if [[ ! -f node_modules/electron/path.txt ]]; then
  npm ci
fi
exec npm start -- "$@"
