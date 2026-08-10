#!/usr/bin/env bash
# session-title-refresh: スキルを削除する。
# スケジュールタスクの削除と、ループが回っているセッションを閉じる操作は
# Claude Code の UI 側で行う必要があるため、この後の手順を表示する。
set -euo pipefail

DEST_DIR="$HOME/.claude/skills/session-title-refresh"

if [ -d "$DEST_DIR" ]; then
  rm -rf "$DEST_DIR"
  echo "削除しました: $DEST_DIR"
else
  echo "スキルは設置されていません: $DEST_DIR"
fi

cat <<'EOS'

残りの手順（Claude Code 側で実行）:
  1. スケジュールタスク一覧から session-title-refresh を削除
  2. ランチャーセッション（/loop が常駐しているセッション）を開き、
     /loop stop でループを止めてからセッションをアーカイブ

Claude に丸ごと頼む場合はこう言えば通ります:
  「session-title-refresh のスキルとタスクを削除して、ループが動いているセッションも閉じて」
EOS
