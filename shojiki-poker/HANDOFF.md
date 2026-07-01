# 正直ポーカー — 開発引き継ぎ文（次セッション用）

> このファイル1枚で、別セッション（記憶なし）からでも開発を続けられるようにまとめてある。
> まず読むべき: この `HANDOFF.md` → `README.md`（セットアップ/手順） → `src/logic/`（計算の正）。

---

## 0. これは何か

日本のライブ／アミューズポーカー勢向けの **収支・実力分析 iOSアプリ**。
収支を入れるだけで bb/100・ROI・インマネ率から「今の実力」を数字で突きつける。
タグライン: **勝てば実力、負けたら運を、もう許さない。**

- ブランド名: **正直ポーカー**（英サブ "Poker Tracker"）
- 変動費0円思想（LLM/サーバー/API不使用・全部端末内）。固定費はApple年$99のみ。
- 元仕様の正: ユーザーが最初に貼った長い引き継ぎ文（EDGE→正直ポーカーのHANDOFF）。ロジック/UX/辛口コピー/価格/審査方針はそこが根拠。**このリポジトリには元プロトタイプ `edge-poker-meter-v2.jsx` は無い**（仕様から実装した）。

---

## 1. リポジトリ / ブランチ（重要）

- repo: `j11046rk-commits/abet-news`（元は別プロジェクト＝A-BET新聞。ポーカーアプリは `shojiki-poker/` サブディレクトリに隔離して作った）
- **作業ブランチ: `claude/shojiki-poker-ios-app-f929hx`**（ここで開発・ここにpush。他ブランチにpushしない）
- コミットメッセージにモデル識別子を書かない。末尾trailerは既存コミット参照。

---

## 2. 現状（v1コア完成・push済み）

実装済み（元HANDOFF §9 の 1〜8）:
- テーマ（フェルト緑/ゴールド/mono数字）§1、データモデル §3、ローカル永続化（AsyncStorage・データは消さない）
- **計算ロジック §4**（`handsPerHour`/`cashStats`/`mttStats`/`grandTotal`）→ `node --test` で11件パス
- 辛口LV判定・サンプル警告 §1
- 3タブ（キャッシュ/トーナメント/成績）§5-1〜3：入力→累計ヒーロー→一覧、実収支トータル、view-shotで1080²シェアカード
- オンボーディング3枚 §5-0
- AdMobバナー（下部固定・防御的）§6、RevenueCat配線＋ペイウォール＋3ヶ月Proゲート §6、設定 §5-4
- 文字なしプレースホルダのアイコン/スプラッシュ（スペード＋右肩上がりの金線）§8

検証: `tsc --noEmit` クリーン / `npm test` 11 pass。

---

## 3. ファイル地図

```
shojiki-poker/
  app.json          Expo設定（bundle: com.shojikipoker.app / extra にAdMob・RevenueCatのキー枠）
  eas.json          EAS Build（development/preview/production + submit）
  package.json      依存・scripts（start / test / typecheck）
  src/
    theme/          colors.ts（カラートークン）/ typography.ts
    types.ts        CashSession / MttEntry / TimelineItem（§3）
    logic/
      calc.ts       §4の全計算（source of truth）
      levels.ts     §1の辛口LVコピー・サンプル警告
      format.ts     円/％/bb100/日付(○月○日(曜))
      gate.ts       §6の3ヶ月Proゲート
      __tests__/calc.test.ts   node標準テスト（依存不要）
    storage/store.ts  AsyncStorage・export/clear・makeId
    context/
      DataContext.tsx  記録CRUD＋累計stats（useData）
      ProContext.tsx   課金状態＋広告ON/OFF＋Proゲート（usePro）
    purchases/purchases.ts  RevenueCat配線（未リンク/キー無でも落ちない）
    ads/BannerAd.tsx        AdMobバナー（同上・防御的）
    components/     Screen / Hero / LevelBadge / Card / Field / Stepper /
                    WinLossAmount / PrimaryButton / RecordRow / LockedNotice / ShareCard
    screens/        Cash / Tournament / Results / Settings / Paywall / Onboarding
    navigation/RootNavigator.tsx  タブ＋スタック
    assets/         icon.png / splash.png（仮・文字なし）
  App.tsx           プロバイダ・オンボゲート・バナー配置
```

---

## 4. すぐ動かす

```bash
cd shojiki-poker
npm install
npm test            # 計算ロジック検証（Apple/Expo不要）
npx expo start      # Expo GoでQR読み取り→実機プレビュー（課金/広告は自動でオフ）
```

---

## 5. 残タスク（本番化・元HANDOFF §9の9〜11, §7, §8）

### A. 生成画像の差し込み（最優先・見た目が本物になる）
ユーザーがChatGPTで生成した画像を **OneDriveの「正直ポーカー」フォルダ** に保存済み。
→ Macなら `shojiki-poker/src/assets/` に置く。スマホなら github.com からそのフォルダにUpload。
差し込み先（コード側の対応）:
- **アイコン/スプラッシュ**: `src/assets/icon.png` `splash.png` を上書き（app.jsonが参照済み）
- **シェアカード背景**: `components/ShareCard.tsx` の `LinearGradient` を `<ImageBackground source={...}>` に差し替え
- **オンボ3枚背景**: `screens/OnboardingScreen.tsx` の各スライド `LinearGradient` を画像に
- **LVエンブレム**: `components/LevelBadge.tsx` の lucideアイコンを、tone/labelに対応した画像に
- 鉄則: 画像に文字は焼かない。名前/数字はアプリ側で実テキスト重ね（§8）。

### B. EAS Build → TestFlight（実機配布・Mac不要だがコマンド入口は要る）
```bash
npm install -g eas-cli
eas login                                   # Expoアカウント
eas init                                    # projectIdをapp.jsonに追記→要commit
eas build --platform ios --profile production
eas submit --platform ios --profile production
```
必要な鍵:
- **Expoアクセストークン**（expo.dev → Account Settings → Access Tokens）
- **App Store Connect API キー**（App Store Connect → Users and Access → Integrations → 生成。`.p8`＋Key ID＋Issuer ID）。役割 App Manager。※使用後Revoke可。
- Apple Developer登録は済み（ユーザー談・Buddy+のとき）。

### C. 本番キーの差し込み（Bの前後で）
- AdMob: `app.json > extra.adBannerUnitIdIOS/Android` と `plugins > react-native-google-mobile-ads` の iosAppId を本番へ（現状はGoogle公式テストID）。
- RevenueCat: `app.json > extra.revenueCatApiKeyIOS/Android` を本番キーに。entitlement `pro`、月額¥300/年額¥2,000のオファリング作成。→ `ProContext` が自動でRevenueCatを真実として扱う。
- CIに置くなら secret経由で `app.json` に注入。

### D. Pro分析画面（§9-9・未実装）
月別/期間指定の収支推移グラフ、曜日別・レート別フィルタ。ゲート土台は `logic/gate.ts` 済み、無料は直近3ヶ月まで（`partitionByGate`）。

### E. App Store審査（§7）
カテゴリ=ファイナンス/ユーティリティ、17+、Description冒頭に「賭博機能を含まない収支管理ツール」位置づけ文、キーワード `ポーカー 収支 記録 トラッカー トーナメント 実力 bb100 ライブ 成績`、サブタイトル「ポーカー収支・実力分析」。責任あるプレイの相談先は設定画面にリンク済み。

### F. 細かい改善
- スワイプ削除（現状は削除ボタン→確認Alert・`RecordRow.tsx`）を gesture-handler Swipeable に。
- 空状態/LVエンブレムのビジュアル強化。

---

## 6. 計算式クイックリファレンス（§4・実装は `logic/calc.ts`）

```
handsPerHour(players) = round(25 * (9/clamp(players,2,10))^0.7)
# cash
sumBB   = Σ(profit/bb)   ; totalHands = Σ(hours*hph)
bb100   = sumBB / (totalHands/100)
hourly  = totalProfit / totalHours
# mtt
invested= Σ(buyin*(1+rebuys)) ; cashes = Σcash
ROI%    = (cashes-invested)/invested*100
ITM%    = 入賞数/n*100 ; avgTop% = mean(finish/field)*100
streak  = 日付降順で連続cash=0 ; best = max(cash)
grandTotal = cashProfit + (cashes-invested)
```
LVしきい値: cash bb100 ≥8/4/0/<0、mtt ROI ≥30/10/0/<0（コピーは `logic/levels.ts`）。
サンプル警告: cash totalHands<5000、mtt n<50。

---

## 7. 新セッションでの再開の仕方

1. このブランチをチェックアウト: `git checkout claude/shojiki-poker-ios-app-f929hx`
2. この `HANDOFF.md` と `README.md` を読む
3. `npm install && npm test` で足場確認
4. 上の残タスク A〜F から着手（画像→キー→ビルドの順が自然）
```
