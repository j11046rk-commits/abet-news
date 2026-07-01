# 正直ポーカー — Poker Tracker (iOS / Expo)

ライブポーカーの収支を入れるだけで、bb/100・ROI・インマネ率から「今の実力」を数字で突きつける自己分析アプリ。
**勝てば実力、負けたら運を、もう許さない。**

> ロジック・UX・計算式・辛口コピーは `HANDOFF`（正直ポーカー引き継ぎ文）が正。本コードはその v1 実装。

## スタック

- **Expo (React Native) + TypeScript** — iOS優先
- **ローカルファースト永続化** — `@react-native-async-storage/async-storage`（キー `cash-sessions` / `mtt-entries`）。データは絶対に消さない。
- **React Navigation** — ボトムタブ3つ（キャッシュ / トーナメント / 成績）＋設定＋ペイウォール
- **シェア画像** — `react-native-view-shot`（1080²）→ `expo-sharing` / `expo-media-library`
- **課金** — RevenueCat（`react-native-purchases`）。実キー未設定時はローカルProフラグにフォールバック。
- **広告** — AdMob（`react-native-google-mobile-ads`）。バナーのみ・下部固定・Pro/オフ時は非表示。
- **LLM不使用** — 変動費を数学的に0円に保つ（HANDOFF §2, §6）。

## セットアップ

```bash
cd shojiki-poker
npm install
npm run start        # Expo Dev Server
# 課金・広告のネイティブ機能は Dev Client / 実機ビルドが必要（Expo Goでは無効）
```

### 計算ロジックのテスト（Node標準のみ・依存不要）

```bash
npm test             # src/logic/__tests__/*.test.ts を node --test で実行
```

`handsPerHour` / `cashStats` / `mttStats` / `grandTotal` / LV判定 / サンプル警告を HANDOFF §4・§1 の数式どおりに検証。

## ディレクトリ

```
src/
  theme/        カラートークン・タイポ(§1)
  types.ts      データモデル(§3)
  logic/        calc(§4) / levels(§1辛口) / format / gate(§6の3ヶ月ゲート) + __tests__
  storage/      AsyncStorage永続化・エクスポート/削除
  context/      DataContext(記録CRUD＋累計) / ProContext(課金＋Proゲート)
  purchases/    RevenueCat配線（防御的・キー未設定でも落ちない）
  ads/          AdBanner（バナーのみ）
  components/    Hero / LevelBadge / Card / Field / Stepper / WinLossAmount / RecordRow / ShareCard 等
  screens/      Cash / Tournament / Results / Settings / Paywall / Onboarding
  navigation/   RootNavigator（タブ＋スタック）
  assets/       icon.png / splash.png（プレースホルダ・文字なし。§8）
```

## 実装済み（v1 / HANDOFF §9 の 1〜8）

- [x] ブランドテーマ（フェルト緑 / ゴールド / mono数字）§1
- [x] ローカル保存＋データモデル §3
- [x] キャッシュタブ（入力→計算→ヒーロー→一覧・スワイプ相当の削除）§5-1
- [x] トーナメントタブ §5-2
- [x] 成績タブ：実収支トータル＋混在一覧＋シェアカード(view-shot) §5-3
- [x] オンボーディング3枚 §5-0
- [x] AdMobバナー（下部固定・防御的）§6
- [x] RevenueCat＋ペイウォール＋3ヶ月Proゲート §6
- [x] 設定（Pro切替 / 広告 / エクスポート / 削除 / 責任あるプレイ）§5-4

## 本番化 TODO（要外部設定・HANDOFF §9 の 9〜11, §7, §8）

- [ ] **生成画像の差し込み**：アイコン/スプラッシュ/シェアカード背景/オンボ/LVエンブレム（`正直ポーカー_画像プロンプト.md`）。現状は文字なしプレースホルダ。
- [ ] **RevenueCat本番キー**：`app.json > extra.revenueCatApiKeyIOS/Android` にCIのsecret経由で注入。entitlement `pro`、月額¥300/年額¥2,000のオファリング。
- [ ] **AdMob本番ユニットID**：`app.json > extra.adBannerUnitId*` と `plugins > react-native-google-mobile-ads` の appId を本番へ（現状はGoogle公式テストID）。
- [ ] **Pro分析画面**（§9-9）：月別/期間指定の推移グラフ、曜日別・レート別フィルタ。ゲート土台は `logic/gate.ts` 済み。
- [ ] **審査**（§7）：カテゴリ=ファイナンス/ユーティリティ、17+、位置づけ文、キーワード。
- [ ] スワイプ削除（現状は削除ボタン→確認）を gesture-handler の Swipeable へ。

## 既知の簡略化

- シェアカード背景はフェルトのグラデ（生成画像が入ったら `ShareCard.tsx` を `ImageBackground` 化）。
- 課金/広告はネイティブ未リンク環境（Expo Go等）では黙って無効化し、設定画面の手動Pro切替でUI確認可。
