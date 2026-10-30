#!/bin/sh
set -eu

main() {
SERVER="__SERVER__"
VERSION="__VERSION__"
SHA256="__SHA256__"
SHARE="${XDG_DATA_HOME:-${HOME}/.local/share}/boarder"
BIN="${HOME}/.local/bin"

say() { printf '%s\n' "$*"; }
die() { printf 'boarder install: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "needs $1"; }
need curl; need tar; need uname
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# Folders this installer creates, so `boarder uninstall` can remove them again when empty (no trace left)
MADE=""
for d in "${HOME}/.local" "${XDG_DATA_HOME:-${HOME}/.local/share}" "${BIN}"; do [ -e "${d}" ] || MADE="${MADE}${d}
"; done

TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT INT TERM

# Node 20+ - the CLI is plain JavaScript with no dependencies
NODE=""
if command -v node >/dev/null 2>&1; then
  maj=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "${maj}" -ge 20 ] 2>/dev/null && NODE=node
fi
if [ -z "${NODE}" ] && [ -x "${SHARE}/node/bin/node" ]; then
  maj=$("${SHARE}/node/bin/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "${maj}" -ge 20 ] 2>/dev/null && NODE="${SHARE}/node/bin/node"
fi
if [ -z "${NODE}" ]; then
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "unsupported system $(uname -s) - on Windows use install.ps1" ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) die "unsupported CPU $(uname -m)" ;; esac
  if [ "${os}" = linux ] && ldd --version 2>&1 | grep -qi musl; then die "Node 20+ is needed (Alpine/musl: apk add nodejs), then run this again"; fi
  say "Node 20+ not found - downloading Node 22 for ${os}-${arch}..."
  D=https://nodejs.org/dist/latest-v22.x
  curl -fsSL "${D}/SHASUMS256.txt" -o "${TMP}/SHASUMS256.txt"
  f=$(grep -o "node-v22[0-9.]*-${os}-${arch}\.tar\.gz" "${TMP}/SHASUMS256.txt" | head -1)
  [ -n "${f}" ] || die "no Node 22 build for ${os}-${arch}"
  curl -fsSL "${D}/${f}" -o "${TMP}/${f}"
  [ "$(sha256 "${TMP}/${f}")" = "$(grep " ${f}\$" "${TMP}/SHASUMS256.txt" | cut -d' ' -f1)" ] || die "Node download checksum mismatch"
  mkdir -p "${TMP}/node" && tar -xzf "${TMP}/${f}" -C "${TMP}/node" --strip-components 1
  mkdir -p "${SHARE}" && rm -rf "${SHARE}/node" && mv "${TMP}/node" "${SHARE}/node"
  NODE="${SHARE}/node/bin/node"
fi

say "Downloading Boarder CLI ${VERSION}..."
curl -fsSL "${SERVER}/cli/boarder-cli-${VERSION}.tgz" -o "${TMP}/cli.tgz"
got=$(sha256 "${TMP}/cli.tgz")
[ "${got}" = "${SHA256}" ] || die "checksum mismatch (expected ${SHA256}, got ${got}) - nothing was installed"
mkdir -p "${TMP}/x" && tar -xzf "${TMP}/cli.tgz" -C "${TMP}/x"
mkdir -p "${SHARE}"; rm -rf "${SHARE}/cli.old"
if [ -d "${SHARE}/cli" ]; then mv "${SHARE}/cli" "${SHARE}/cli.old" || die "could not move the old CLI aside"; fi
if ! mv "${TMP}/x/package" "${SHARE}/cli"; then [ ! -d "${SHARE}/cli.old" ] || mv "${SHARE}/cli.old" "${SHARE}/cli"; die "could not put the new CLI in place - the old one was kept"; fi
rm -rf "${SHARE}/cli.old"

mkdir -p "${BIN}"
if [ "${NODE}" = node ]; then N=node; else N="\"${NODE}\""; fi
printf '#!/bin/sh\nexec %s "%s/cli/bin/boarder.mjs" "$@"\n' "${N}" "${SHARE}" > "${BIN}/boarder"
chmod +x "${BIN}/boarder"
"${BIN}/boarder" --version >/dev/null || die "installed, but \`${BIN}/boarder --version\` failed"
[ -z "${MADE}" ] || printf '%s' "${MADE}" >> "${SHARE}/created-dirs"

say "Installed boarder ${VERSION} (${BIN}/boarder, SHA-256 checked)."
# Shell files (.zshrc, .bashrc, .profile) are never edited: installing Boarder must not change a person's setup. Off PATH, print the full path instead.
case ":${PATH}:" in
  *":${BIN}:"*) ;;
  *) say "${BIN} is not on your PATH - run it as ${BIN}/boarder (your shell files were not changed)." ;;
esac
say ""
say "Next: boarder setup   (signs this machine in to your board - approve it in the browser)"
}

# The whole script is one function called on the last line: if the download is cut off, sh never runs a half script.
main "$@"
