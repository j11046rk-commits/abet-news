#!/usr/bin/env bash
# session-title-refresh: スキルをデスクトップ版 Claude Code に設置する。
# 既に同名スキルがある場合は上書きせず中止する。
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$HOME/.claude/skills/session-title-refresh"
DEST="$DEST_DIR/SKILL.md"

if [ -e "$DEST" ]; then
  echo "中止: $DEST が既に存在します。上書きしません。" >&2
  echo "差分を確認するには: diff \"$DEST\" \"$SRC_DIR/SKILL.md\"" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp "$SRC_DIR/SKILL.md" "$DEST"
echo "設置しました: $DEST"
echo
echo "次はスケジュールタスクを1つ作成してください（手順は README.md）。"
echo "タスクのプロンプトは $SRC_DIR/task-prompt.md の中身をそのまま貼り付けます。"
