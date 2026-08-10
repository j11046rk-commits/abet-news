# 飲食店・居酒屋の経営指標 体系調査（出典つき）

**調査条件の注記**：この環境では WebFetch が egress proxy に全面ブロックされているため、一次ソースの本文全文取得はできず、WebSearch が返す要約＋URL に基づいている。数値の粒度が粗い箇所は「複数ソースで一致した幅」として記載した。

---

## 0. 先に結論：しっぽり亭の判定サマリ

| # | 指標 | 今すぐ出せる | seat_log 蓄積後に出せる | 追加入力が要る | 原理的に出せない |
|---|---|---|---|---|---|
| 1 | 日商・曜日別/月別日商 | ● | | | |
| 2 | 日次 RevPASH（日商÷(36×営業h)） | ● | | | |
| 3 | 従業員1人当たり日商（日商÷出勤人数） | ● | | | |
| 4 | ネット予約比率（予約内訳） | ● | | | |
| 5 | 坪月商 | | | 坪数を1回入力 | |
| 6 | 客数・客単価 | | ● | | |
| 7 | 客席回転率 | | ● | | |
| 8 | 座席稼働率（時点・席種別） | | ● | | |
| 9 | 平均滞在時間 | | ● | | |
| 10 | 時間帯別 RevPASH | | △（按分が必要） | | |
| 11 | 予約経由比率 | | ●（2026-08〜） | | |
| 12 | ノーショー率 | | | 予約×来店の突合フラグ | |
| 13 | キャンセル率 | | | キャンセルstatus | |
| 14 | 予約リードタイム | | | 予約**作成日時** | |
| 15 | 人時売上高 | | | シフトに**開始/終了時刻** | |
| 16 | 人件費率・労働分配率 | | | 時給マスタ | |
| 17 | 失注（満席で断った数） | | | 断りログ | |
| 18 | リピート率・LTV | | | （予約客のみ・飛び込みは不可） | 全客では× |
| 19 | 原価率・FL比率・FLR | | | | ●（仕入・家賃なし） |
| 20 | 営業利益率 | | | | ●（P/Lなし） |

---

## 1. 売上分解

### 1-1. 売上 = 客数 × 客単価
最も基本の分解。[データのじかん](https://data.wingarc.com/kpilogictreeofrestaurantindustry-32909) / [ユビレジ](https://ubiregi.jp/pos-regi-guide/kyakusu_kyakutanka) が KPI ツリーの起点として提示。客数はさらに「時間帯別／新規・リピーター別／性別・年代別」に割れる。

- **居酒屋の客単価目安：3,000〜5,000円**（[居酒屋のビジネスモデル](https://insyoku-portal.jp/gyoutai/izakaya/)）。業界データでは**平均3,500円・1日約1.8回転**という提示も（[東京居抜き物件ニュース](https://godproperty.jp/news/method/13122/)）。調査によっては「パブ／居酒屋 2,283円」という低い数字もあり、業態定義でブレる。
- **しっぽり亭の判定**：**現状は出せない。seat_log 蓄積後に出せる。** 会計単位データがないため、客数は「seat_log のセッション数（1席1回の着席＝1人）」で代替する。客単価は `日商 ÷ セッション数`。**ただし精度は seat_log のタップ漏れ率に直結する**ので、記録率のモニタ指標（例：着席行数が0の営業日を検知）を最初に作るべき。

### 1-2. 売上 = 席数 × 回転率 × 客単価（×稼働率）
日本の実務では2つの式が併存している。

- `売上 = 客席数 × 客席回転率 × 客単価 × 営業日数`（[Square](https://squareup.com/jp/ja/townsquare/how-to-calculate-restaurants-turnrate-effect) / [店舗買取り.com](https://www.k-tenpo.com/column/319/)）
- `売上 = 客単価 × 席数 × 回転数 × 稼働率`（[canaeru](https://canaeru.usen.com/diy/opening/p959/)）

**注意：この2式は二重計上になりうる。** 「回転率＝1日来店者数÷席数」で定義するなら稼働率は既に織り込まれている。稼働率を掛けるのは「回転数＝テーブルが埋まった回数」と定義した場合。**しっぽり亭で実装するときは、回転率の定義を `延べ着席人数 ÷ 36` に固定して、稼働率とは別指標として扱うのが安全。**

- **参考ケース**：客単価3,000円・1日2回転・70席・稼働率70% → 日商29.4万円（[飲食開業のミカタ](https://insyoku-mikata.vector.co.jp/posts/168/)）

### 1-3. 坪当たり売上（坪月商）
`坪月商 = 月商 ÷ 店舗総坪数`（[マネーフォワード](https://biz.moneyforward.com/restaurant/basic/1678/) / [freee](https://www.freee.co.jp/kb/kb-hanbai-kanri/area-monthly-sales/)）

| 水準 | 坪月商 |
|---|---|
| 経営が厳しい | 10万円未満 |
| 最低ライン | 15万円 |
| 標準 | 15〜20万円 |
| 理想 | 20万円超 |
| 繁盛店 | 30万円以上 |

（[マネーフォワード](https://biz.moneyforward.com/restaurant/basic/1678/) / [居酒屋ビジネスモデル](https://insyoku-portal.jp/gyoutai/izakaya/)：一般店は坪20万まで、30万超で繁盛店）

- **関連する設計値**：1坪あたりの席数は **ゆったり型1.5〜1.8席／一般2.0席／大衆型2.5〜2.7席**、居酒屋の厨房面積比率は **20〜30%**（[飲食店ドットコム](https://www.inshokuten.com/bukken/media/431) / [canaeru](https://canaeru.usen.com/diy/operation/p40/)）
- **しっぽり亭の判定**：**坪数を1回入力すれば即出せる。** 36席は個室掘りごたつ含みなので「一般〜ゆったり型」＝坪2席弱と仮定すると客席18坪前後、厨房25%込みで**総24坪前後**と推定。月商250〜280万円なら坪月商は**約10〜12万円** ＝ 上表では「厳しい」〜「最低ライン未満」。**これは実測坪数で必ず検証すべき最重要ギャップ。** ただし坪月商は「家賃が売上の10%以内」（[bukennavi](https://bukennavi.jp/kanto/opening/knowhow/synthesis9/41)）とセットで見る指標なので、家賃が安い地方個人店では絶対値だけで断罪できない点に注意。

### 1-4. 組数・1組あたり人数
- 全国データでは **1組あたり平均来店人数4.1人（2024年10月）**（[ebica 飲食店予約レポート2025](https://www.ebica.jp/news/press/reservation-report-2024-detail/)）
- **しっぽり亭の判定**：予約分は**出せる**（予約データに人数がある）。飛び込み含む全体は、**seat_log が「席単位」なので組を直接持たない** → 「同一テーブル群で着席時刻が±数分以内のセッションを1組とみなす」というグルーピング推定が必要。**これは seat_log の設計上の穴**。タブレット側で「組ID」を打てるなら、後の分析コストが激減する。

---

## 2. 収益性

### 2-1. FL比率
`FL比率(%) = (食材原価 F + 人件費 L) ÷ 売上高 × 100`

| 水準 | FL比率 |
|---|---|
| 理想 | 55%以下 |
| 適正上限 | 60%以下 |
| 内訳の定石 | F 30% ＋ L 30% |

（[Airレジマガジン](https://airregi.jp/magazine/guide/2259/) / [中小企業診断士解説](https://tsuyocon.com/fl-hiritu-kaizen/) / [厨房ベース](https://chubou-base.com/blog/fl-cost/)）
内訳の実務レンジは **食材費24〜40%／人件費20〜36%**（[飛鳥フードコンサルティング](https://asuka-food-consulting.com/roudoubunpairitu/)）。

**米国の同義語は Prime Cost**：目標60%以下、良好55〜60%、業界平均58〜62%（[Whipplewood](https://whipplewood.com/insights/financial-benchmarks-for-restaurants/) / [ChowNow](https://get.chownow.com/blog/restaurant-industry-benchmarks/)）。日本の「FL 60%」は国際標準とほぼ一致する。

### 2-2. FLR比率
`FLR = (食材費 + 人件費 + 家賃) ÷ 売上高`、**目安70%以下**、うち **R（家賃）は10%以内**（[Airレジマガジン](https://airregi.jp/magazine/guide/2259/) / [テンポケイエイ](https://tenpo-keiei.com/management/article-2dca)）。

### 2-3. 原価率
| 対象 | 目安 |
|---|---|
| 飲食店全般 | 30%前後 |
| 居酒屋 全体 | 25〜35% |
| フード単体 | 30〜35% |
| ドリンク単体 | 20〜25% |

（[スマレジ akinai-lab](https://akinai-lab.smaregi.jp/operation/izakaya-costrate/) / [カメヤ](https://www.kameya.co.jp/pro-tips-basics-2/) / [freee](https://www.freee.co.jp/kb/kb-hanbai-kanri/restaurant-cost-price/)）
実例：刺身盛り約50%、煮魚40%弱、枝豆・冷奴・ポテト20〜25%台（[テンポスフードメディア](https://www.tenpos.com/foodmedia/newstrend/29033/)）。**居酒屋はドリンクの低原価でフードの高原価を薄める構造**なので、ドリンク比率（＝ドリンク売上／総売上）が実質的なKPIになる。

米国 FSR の食材費は業界平均 **32.4%**、最適レンジ28〜35%（[ChowNow](https://get.chownow.com/blog/restaurant-industry-benchmarks/)）。

### 2-4. 人件費率
`人件費率(%) = 人件費 ÷ 売上高 × 100`、**目安25〜35%、理想25〜30%**（[スマ飲食経営](https://smasel.com/media/restaurant-labor-cost-ratio/) / [LEAP](https://leap-it.jp/newton/column/personnel-costs/)）

**落とし穴（重要）**：法定福利費が給与の約15%が会社負担になるため、`給与 × 1.16` で概算しないと「30%のつもりが35%超」になる（[INVOY](https://go.invoy.jp/how-to-invoice/)）。しっぽり亭のような個人店で店長が無給に近い場合、L が異常に低く出て FL が健全に見えてしまう **── 店長の労働に「みなし人件費」を入れないと指標が嘘になる。**

### 2-5. 営業利益率
| 水準 | 営業利益率 |
|---|---|
| 黒字最低ライン | 5%前後 |
| 業界平均 | 8.6〜10.8% |
| 安定経営 | 10%以上 |
| 店主一人運営の個人店 | 20〜40%（人件費が抜けるため） |

（[freee](https://www.freee.co.jp/kb/kb-accounting/restaurant-profit-margin/) / [OpenKitchen](https://www.openkitchen-app.jp/blog/restaurant-profit-margin-guide) / [マネーフォワード](https://biz.moneyforward.com/restaurant/basic/469/)）

### 2-6. 損益分岐点
`損益分岐点売上高 = 固定費 ÷ (1 − 変動費率)`
`損益分岐点比率 = 損益分岐点売上高 ÷ 実際の売上高`
黒字企業平均 **80%前後**、赤字企業は100%超。飲食店では**90%超で要改善**（[POS+](https://www.postas.co.jp/makesmiles/2767/) / [飲食店ドットコム](https://www.inshokuten.com/foodist/article/4714/)）。

### 収益性についての しっぽり亭の判定
**FL比率・FLR・原価率・営業利益率・損益分岐点は、すべて原理的に出せない。** 仕入データ・家賃・P/L がシステムにない。
- **人件費率だけは「推定できる」**：確定シフトの出勤人数 × 想定時給 × 想定勤務時間。ただし**シフトに時間帯がない**のが致命的で、精度は粗い。
- **提案**：オーナーに聞くべき数字は「家賃（月額固定）」「坪数」「時給マスタ」の3つだけ。この3つで坪月商・人件費率・FLR の R が埋まり、原価だけが残る。原価は月次の仕入合計を1行入れてもらうだけで月次FLが成立する。**日次の完全な原価管理を目指さないのが個人店では正解。**

---

## 3. 生産性

### 3-1. 人時売上高 / 人時生産性
```
人時売上高 = 売上高 ÷ 総労働時間
人時生産性 = 粗利高 ÷ 総労働時間
```
（[飲食店ドットコム](https://www.inshokuten.com/foodist/article/4468/) / [食べログ オーナーズブログ](https://owner-blog.tabelog.com/keiei/post-7.html) / [花王プロフェッショナル](https://pro.kao.com/jp/food-biz-support/management/business-column/013/)）

| 水準 | 人時売上高 |
|---|---|
| 平均 | 3,000〜4,000円 |
| 一つの基準 | 4,000〜5,000円 |
| 優良店 | 5,000円超 |

（[canaeru](https://canaeru.usen.com/opening/zyunbi441.html) / [chef-link](https://chef-link.com/business/journal/restaurant-jinji-productivity/)）

**落とし穴**：高すぎる人時売上高は「人が足りずに客に迷惑をかけている」サインでもある（[飲食店ドットコム](https://www.inshokuten.com/foodist/article/4468/)）。上限を持つ指標として扱うべきで、単調に最大化してはいけない。

### 3-2. 労働分配率
`労働分配率 = 人件費 ÷ 粗利 × 100`、**目安40%前後、43%超で赤字リスク**（[飛鳥フードコンサルティング](https://asuka-food-consulting.com/roudoubunpairitu/)）。中小企業一般の業種別平均は[freee](https://www.freee.co.jp/kb/kb-accounting/labor-share/)参照。人件費率30%を守っていても粗利率が低ければ労働分配率は破綻する ── **「人件費率30%だけでは不十分」の根拠がこれ。**

### 3-3. 1人当たり接客席数 / 従業員1人当たり売上高
- ホール1人あたりの担当目安：**4人掛けテーブル×4卓（＝16席）程度**。カウンター中心や1〜2名客が多い店では**1人で16名担当**のイメージ（[オーダーアール](https://orderr.biz/media/how-to-caliculate-number-of-restaurant-staff/) / [バルテック](https://www.webjapan.co.jp/shop-opening/number-of-employees/)）
- **個人飲食店では従業員1人当たり年商1,000万円程度がないと継続が難しい**（[飲食店ドットコム](https://www.inshokuten.com/foodist/article/4468/)）

### 生産性についての しっぽり亭の判定
- **従業員1人当たり日商 ＝ 日商 ÷ その日の出勤人数：今すぐ出せる。** 確定シフトと日次売上だけで成立する、**現時点で唯一まともに動く生産性指標**。曜日別・月別に出せば「水木の谷は客が来ないのか、人を入れすぎているのか」が分離できる。
- **人時売上高：シフトに開始/終了時刻を足せば出せる。** これが最も費用対効果の高いデータ追加。現状「誰がどの日に出勤したか」しかないため総労働時間が不明。タブレットで打刻を取るのが理想だが、**シフト表に「18-24」のような時間帯文字列を1列足すだけでも実用精度に届く。**
- **1人当たり接客席数：今すぐ出せる**（36 ÷ 出勤人数）。seat_log 後は「実際に稼働した席数 ÷ 出勤人数」に精緻化できる。上の目安（1人16席）に照らすと、36席を回すには**ピーク時2〜3人**が必要という設計値が出る。
- **労働分配率：出せない**（粗利がない）。

---

## 4. 席の効率 ── ここが本題

### 4-1. 客席回転率
`客席回転率(回) = 1日の来店者数 ÷ 席数`
30席に60人 → 2回転（[Square](https://squareup.com/jp/ja/townsquare/how-to-calculate-restaurants-turnrate-effect) / [店舗買取り.com](https://www.k-tenpo.com/column/319/)）

| 業態 | 回転率目安 |
|---|---|
| 居酒屋 | 1.5〜2.5回（実測平均1.8回） |
| 米国 FSR | 1.5〜2.5回（ピーク時1.5〜2.0） |
| 米国 QSR | 3〜5回 |

（[居酒屋ビジネスモデル](https://insyoku-portal.jp/gyoutai/izakaya/) / [Lightspeed](https://www.lightspeedhq.com/blog/restaurant-kpis/) / [ChowNow](https://get.chownow.com/blog/restaurant-industry-benchmarks/)）
**回転率と客単価は逆相関**：単価が低い業態ほど回転が高い（[日清オイリオ](https://foodservice.nisshin-oillio.com/library/2023-010/)）。

### 4-2. 座席稼働率（seat occupancy）
`客席稼働率 = 実際の客数 ÷ 着席可能人数`
**平均60〜70%（65〜70%とする資料が多い）**（[飲食開業のミカタ](https://insyoku-mikata.vector.co.jp/posts/168/) / [iPad Solution Lab](https://lab.ipad-solution.com/increased-sales/)）

**構造的な落とし穴**：4名テーブルに2名を通すたび、**2席が不可逆に死ぬ**（"each time a party of two is seated at a table for four, the two extra seats will be irremediably wasted" ── [REMS](https://www.remshospitality.com/blog/revpash-the-unknown-but-most-effective-restaurant-kpi)）。だから **table occupancy（卓が埋まっているか）と seat occupancy（席が埋まっているか）は必ず分けて見る。** カウンター席・2名席を増やすのが稼働率対策の定石（[飲食開業のミカタ](https://insyoku-mikata.vector.co.jp/posts/168/)）。

### 4-3. 平均滞在時間
居酒屋の平均滞在時間は **2〜3時間**、「2時間」が基準になるのは飲み放題・席時間制限が2時間設定だから（[neo-emotion](https://neo-emotion.jp/izakaya-aberage-time/) / [レストランスター](https://res-star.com/archives/column/dwell-time)）。滞在時間は客単価・回転率・利益率のすべてに効く上流変数。

---

### 4-4. RevPASH（Revenue per Available Seat Hour）── 重点

#### 定義と提唱者
Cornell 大学 **Sheryl E. Kimes** 教授が提唱。レストランの「販売単位はメニューではなく、サービスに要する時間である」という発想が出発点（[Cornell eCommons: Restaurant Revenue Management](https://ecommons.cornell.edu/bitstreams/56f1b36d-beb8-42fb-aeea-9fdb59be6c29/download) / [eCornell](https://ecornell.cornell.edu/certificates/hospitality-and-foodservice-management/restaurant-revenue-management/)）。

#### 計算式（2通り、同値）
```
【基本形】 RevPASH = 期間売上 ÷ (利用可能席数 × 対象時間)
【分解形】 RevPASH = 座席稼働率 × 客単価 ÷ 平均滞在時間(h)
```
日本語では `売上 ÷ (席数 × 営業時間 × 営業日数)`、「座席稼働率 × 平均単価」とも表現される（[月刊ホテレス](https://www.hoteresonline.com/articles/6490) / [マネーフォワード ERP](https://biz.moneyforward.com/erp/basic/3255/) / [7shifts](https://www.7shifts.com/blog/revpash-for-restaurants/) / [altexsoft](https://www.altexsoft.com/glossary/revpash/) / [Black Box Intelligence](https://blackboxintelligence.com/resources/restaurant-glossary/revenue-per-available-seat-hour/)）。

例：40席・ディナー3時間・売上€1,200 → 1200 ÷ (40×3) = **€10/席時**

#### なぜ他の指標より優れているのか
- 稼働率だけ見ると**売上が抜ける**：「満席だが客が喋っているだけで注文しない」が見えない（[eatapp](https://restaurant.eatapp.co/blog/revpash-formula)）
- 客単価だけ見ると**席の遊びが抜ける**
- 回転率だけ見ると**単価が抜ける**
- **RevPASH は「稼働率 × 単価 ÷ 時間」を1つの数字に統合する**ため、行動に直結する（[7shifts](https://www.7shifts.com/blog/revpash-for-restaurants/)）
- **満席は目標ではない**：稼働率だけ上げると厨房が追いつかず、提供時間が伸び、ミスが増え、体験が劣化する（"The Capacity Myth" ── [SevenRooms](https://sevenrooms.com/blog/restaurant-revpash/)）

#### 実証事例（Chevys Arrowhead / Cornell）
ピーク時の座席稼働率 **50% → 59%**、平均滞在 **53分 → 51分**、ピーク RevPASH **$5.85 → $6.32**（[Cornell: Determining the Best Table Mix](https://ecommons.cornell.edu/server/api/core/bitstreams/f812c462-85df-4ce8-83d4-898868776c81/content)）。改善幅は約8% ── **RevPASH は数十%動く指標ではなく、数%を積む指標**である点は期待値管理として重要。

#### ベンチマーク
**普遍的なベンチマークは存在しない。** 2時間回転・$150客単価のファインダイニングと、45分回転・$25のカジュアルでは「良いRevPASH」が全く違う。参考値として QSR $15前後、ファインダイニングは週末ディナーのピーク帯で **$40超**を目指す（[HappyChef](https://happychef.cloud/en/blog/finance/revpash-restaurant-kpi.html)）。**絶対値より自店の時系列比較と時間帯間比較が本質**（[7shifts](https://www.7shifts.com/blog/revpash-for-restaurants/)）。

#### 落とし穴（重要度順）

1. **分母の「営業時間」の定義が曖昧**
   開店〜閉店か、実際に客が座り得る時間（L.O.まで）か。しっぽり亭は 18:00〜24:00（金土25:00）で**曜日によって分母が変わる**。ここを統一しないと曜日比較が壊れる。

2. **時間帯を跨ぐ食事の按分**（Cornell が明示的に指摘）
   時間帯別 RevPASH を出すとき、伝票の**オープン時刻だけで集計すると誤る**。客は滞在中ずっとキャパを消費しているので、**オープン時刻とクローズ時刻の両方を使って按分**すべき（[Cornell: Accurately Estimating Time-Based Restaurant Revenues Using RevPASH](https://ecommons.cornell.edu/entities/publication/145baa88-8ed3-47eb-84ea-93e442ec0056)）。**しっぽり亭は日次売上しかないので、この按分は必然的に seat_log の「席×時間」で行うことになる。**

3. **席 vs 卓の不一致**
   4名卓に2名で2席が死ぬ問題（上述）。**しっぽり亭の seat_log は席単位（36席）なので、この点では構造的に有利** ── 多くの店が持てない粒度を最初から持っている。

4. **利益を見ていない**
   RevPASH は売上のみ。メニューごとの限界利益が違うので、RevPASH が上がっても利益が下がる事象が起きる。これに対して **ProPASH（Profit per Available Seat Hour）／ProPASM（Profit per Available Square Meter）** が提唱されている（[ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0278431916303140) / [Academia: Is RevPASH the best performance indicator?](https://www.academia.edu/71728727/Is_RevPASH_the_best_performance_indicator_for_restaurant_revenue_management)）。**しっぽり亭は原価がないので ProPASH は当面不可**だが、「RevPASH最大化＝利益最大化ではない」という但し書きは UI に書くべき。

5. **式そのものへの学術的批判**
   「席数 × サービス時間」という慣行的な分母は分析上の限界があり、代替表現が提案されている（[Hospitality Net](https://www.hospitalitynet.org/opinion/4117170.html) / [Journal of Revenue and Pricing Management](https://link.springer.com/article/10.1057/s41272-023-00446-6)）。

6. **座席稼働率の低下は複数原因の合成**
   需要減・サービス品質・調理時間・卓回転時間のどれでも下がる。RevPASH 単体では原因が特定できず、**seat utilization と併読して初めて意味を持つ**（[REMS](https://www.remshospitality.com/blog/revpash-the-unknown-but-most-effective-restaurant-kpi)）。

#### しっぽり亭固有の落とし穴（設計時に必ず織り込むべき4点）

**(A) 物販・催事売上は分子から除外する。**
2026-07-26 の 680,830円（うち物販62.3万）をそのまま入れると
`680,830 ÷ (36席 × 6h) = 2,702円/席時` という異常値になる。
物販を除くと店内売上は約57,830円 → `57,830 ÷ 216 = 268円/席時` ── **水曜平均（320円）を下回る。**
つまり「うなぎ太巻きの日は店内が死んでいた可能性」が RevPASH で初めて可視化される。**物販を分けないと、この最重要な発見が真逆に見える。** 売上に `店内 / 物販` のフラグを持たせるのが最優先の改修。

**(B) 曜日で営業時間が違うので分母を曜日別にする。**
既知の曜日別日商から日次 RevPASH を試算すると（日〜木=6h、金土=7h）：

| 曜日 | 日商 | 営業h | RevPASH |
|---|---|---|---|
| 土 | 135,142 | 7 | **536円** |
| 金 | 129,281 | 7 | **513円** |
| 日 | 84,224 | 6 | 390円 |
| 月 | 83,543 | 6 | 387円 |
| 火 | 79,540 | 6 | 368円 |
| 木 | 72,755 | 6 | 337円 |
| 水 | 69,178 | 6 | **320円** |

**発見**：生の日商では 土/水 = **1.95倍**だが、RevPASH では **1.67倍**に縮む。**金土の優位の約14%は「1時間長く開けているだけ」で説明がつく。** 「金土は水木の1.7倍」という既存認識は、席効率で見ると過大評価。これは日次売上だけで**今日から出せる**。

**(C) 個室掘りごたつ8席は構造的に RevPASH が低く出る。**
4名で個室を使えば実効稼働50%。**席種別（カウンター10 / テーブル18 / 個室8）に RevPASH を分けないと、個室が「効率が悪い」と誤診される。** 個室は単価が高い・予約が取れる・断りが減るという別の価値があるので、席種別 RevPASH ＋ 席種別客単価をセットで見る。

**(D) 手動タップの記録漏れ。**
seat_log はタブレット手動タップ。「立った時刻」の押し忘れが最も起きやすく、これは**滞在時間を過大→ RevPASH を過小**にする。閉店時刻を超えるセッションは自動クローズする、押し忘れ率を日次で表示する等のガードが要る。

#### 実装できる形
- **今日から**：日次 RevPASH ＝ `(日商 − 物販) ÷ (36 × 曜日別営業時間)`。894日分すべてに遡及適用可能。**過去2年半の RevPASH 時系列がいきなり手に入る。**
- **seat_log 蓄積後（目安：30営業日〜）**：30分刻みの時間帯別 RevPASH。日商を「各30分枠の 着席席数×0.5h」で按分するのが現実解。近似であることを明記すること（飲み放題・コース・物販で歪む）。
- **さらに後**：席種別 RevPASH、曜日×時間帯ヒートマップ。**水木の谷が「客が来ない」のか「早い時間だけ空いている」のかが初めて分離できる。**

---

## 5. 顧客

### 5-1. リピート率 / リピーター率
```
リピート率(%) = 2回目以降の来店客数 ÷ 初回来店客数 × 100
リピーター率(%) = 特定期間の来店客に占める既存顧客の割合
```
（[ぐるなび通信](https://pro.gnavi.co.jp/magazine/t_res/cat_3/a_4237/) / [テンポミル](https://note.com/tenpomiru/n/nc2ad5a425758)）
「新規がどれだけ戻ってきたか」を見るリピート率のほうが施策に直結する。

| 水準 | リピート率 |
|---|---|
| 改善余地大 | 30%未満 |
| 標準 | 30〜50% |
| 優良店 | 50%以上 |
| 常連化成功 | 70%以上 |

（[オーダーアール](https://orderr.biz/media/how-to-increase-the-repeat-rate-at-restaurants/)）

**パレートの法則**：上位2〜3割の常連が売上の7〜8割を作る。**新規売上比率が5割超の店は利益率が極端に低い**（[ONE'S](https://one-s.co.jp/blog/sales/sales-ratio) / [サングローブ](https://www.sungrove.co.jp/repiat_attract/)）。関連する経験則として「3回安定・10回固定の法則」（[コラボパートナー](https://collabopartner.com/2025/08/12/restaurant-customer-retention-strategy-3-visit-10-visit-rule/)）。

### 5-2. LTV（顧客生涯価値）
飲食・小売では `LTV = 客単価 × 来店頻度 × 継続期間`
汎用形は `購入単価 × 購買頻度 × 継続期間 × 粗利率 −（新規獲得費用＋顧客維持費用）`（[繁盛マーケティング](https://sushi-marketing.com/marketing/about-ltv) / [SATORI](https://satori.marketing/marketing-blog/ltv/)）

### 顧客についての しっぽり亭の判定
- **リピート率：予約客のみ、部分的に出せる。** 予約データに**電話番号がある**のが決定的に有利 ── 電話番号をキーに再来店を追える。ただし2026-08運用開始なので、意味のある数字が出るのは**最低6ヶ月後**。
- **飛び込み客のリピートは原理的に不可。** seat_log は個人を識別しない。ここを埋めるにはLINE等の別手段が要る。
- **LTV：粗い推定に留まる。** 客単価が「日商÷推定客数」でしか出ないので、個人別の単価が不明。「予約客の来店回数 × 全店平均客単価」までしか出せない。**個人店では LTV より「予約客の90日以内再予約率」のほうが実用的**（分母が明確で、施策に直結する）。
- **注意**：電話番号は個人情報。集計は必ずハッシュ化し、画面に生番号を出さない設計にすること。

---

## 6. 予約まわり

### 6-1. ノーショー率・キャンセル率
- **ノーショー率 0.9%（経済産業省委託調査「No show 対策レポート」2018）、年間被害額 約2,000億円**（[TableCheck](https://www.tablecheck.com/ja/company/press/no-show-survey-2017/) / [METI Journal](https://journal.meti.go.jp/p/8662/)）
- **直前キャンセルを含めた業界全体の被害総額は年間約1.6兆円**（経産省推計）
- **ノーショー理由トップ**：「とりあえず予約」34.1%、「人気店だから予約」32.5%、「予約を忘れた」30.2%、「予定自体が中止」24.6%、「悪天候」21.4%（[飲食店ドットコム](https://www.inshokuten.com/foodist/article/5577/)）
- **経路差が大きい**：グルメサイト経由の予約はノーショーが**圧倒的に多く**、自社サイト・SNS経由は少ない。20〜30代のグルメサイト予約で特に高い（[TableCheck 第3回調査](https://prtimes.jp/main/html/rd/p/000000044.000023564.html)）
- **7割の飲食店が無断キャンセル対策を実施しておらず、4割で発生**（[TableCheck / NIKKEI COMPASS](https://www.nikkei.com/compass/content/PRTKDB000000032_000023564/preview)）
- 12月は予約総数が増えキャンセル実数も増えるが、**キャンセルに占めるノーショーの割合はむしろ低い**

**→ しっぽり亭への含意**：予約データに**流入元（電話/ネット/飛び込み）が既にある**のは強い。**ネット経由のノーショー率と電話経由のノーショー率を分けて出す**だけで、「ネット予約に前金・カード登録を入れるべきか」の意思決定材料になる。母数0.9%は小さいので、月20件の予約では年数件しか出ない ── **率ではなく「件数と損失額の累計」で見せるべき指標。**

### 6-2. 予約経由比率・ネット予約比率
- 全国トレンド：2024年はネット予約 **前年比113%**、電話予約 **前年比93%** でネットシフトが進行（[ebica 飲食店予約レポート2025](https://www.ebica.jp/news/press/reservation-report-2024-detail/)）
- **ただし年末は電話予約比率が48.5%に上昇**（忘年会シーズンは電話に戻る ── [トレタ](https://prtimes.jp/main/html/rd/p/000000083.000038464.html)）
- 実態調査では**最多経路は依然「電話」**（[飲食店ドットコム](https://www.inshokuten.com/research/magazine/article/68)）
- **予約充足率の目安：週末70%以上、平日50%以上**（[カチプロ 飲食店KPI一覧](https://pro-marketing.jp/restaurant/insyoku-keiei-kpi-guide/)）

### 6-3. リードタイム
- 通常利用は **2〜3日前**、人気店・週末は **1週間以上前**が推奨される（[アールリザーブ](https://r-reserve.com/column/restaurant-reserve-daysbefore/)）
- 業界トレンドとして「**来店直前でもネット予約が伸びている**」＝リードタイムの短期化（[ebica](https://www.ebica.jp/column/seminar-report/postas201117/)）
- トレタは日別・時間帯別の予約件数と来店率、**リードタイム分析でスタッフ配置・仕入れを最適化**する機能を提供（[トレタ](https://dx.bizocean.jp/category/appointment/toreta_AP/)）── つまり**リードタイムの主用途は「何日前に人員と仕入れを確定できるか」**であって、集客指標ではない。

### 6-4. 失注（満席で断った数）
標準的な業界指標名は存在しないが、機会損失の文脈で頻出。「予約機会の多くが**営業時間外や忙しい時間帯**の電話・ネット経由で発生しており、そこを拾えない店は知らないうちに売上を失っている」（[Somewhere](https://somewhereltd.jp/info/?p=415)）。

### 予約まわりの しっぽり亭の判定
| 指標 | 判定 | 理由 |
|---|---|---|
| ネット予約比率（予約内での構成比） | **今すぐ出せる** | 流入元カラムがある |
| 予約経由比率（総客数に占める予約客） | **seat_log 後** | 分母の総客数が seat_log 依存 |
| 予約充足率（予約人数 ÷ 36席） | **今すぐ出せる** | 週末70%/平日50%の目安と直接比較可 |
| キャンセル率 | **要追加** | 予約レコードに status（確定/キャンセル/来店/ノーショー）が要る |
| ノーショー率 | **要追加** | 上記 status ＋ 来店実績の突合。seat_log と予約の紐付けで自動化できる |
| リードタイム | **要追加** | 予約**作成日時**が現状のカラム一覧にない。1カラム追加で解決 |
| 失注（満席で断った数） | **完全に出せない** | 記録していない |

**→ 最も安価で最も価値が高いのは「失注ログ」。** タブレットに「満席で断った：人数・希望日時」を1タップで記録するボタンを置くだけ。これは **RevPASH と対になる指標**で、「RevPASH が低い＝席が余っている」のか「RevPASH が低いのに断っている＝席種のミスマッチ（4名卓に2名、個室が塞がっている）」のかを分離する唯一の手段。**36席・水木が谷・金土が満席という構造のしっぽり亭では、失注データが最も意思決定を動かす可能性が高い。**

---

## 7. 実装優先度の提言（データ追加コスト順）

| 優先 | 追加するもの | コスト | 解放される指標 |
|---|---|---|---|
| 1 | 売上に `店内/物販` フラグ | 極小 | **RevPASH が正しくなる**（これがないと催事日が全指標を汚染する） |
| 2 | 坪数を1回入力 | 極小 | 坪月商（業界ベンチマークと直接比較できる唯一の指標） |
| 3 | 失注ログ（1タップ） | 小 | 機会損失、席種ミスマッチ検出 |
| 4 | 予約に作成日時 + status | 小 | リードタイム、キャンセル率、ノーショー率（経路別） |
| 5 | seat_log に「組ID」 | 小 | 組数、1組人数、卓稼働率 vs 席稼働率の分離 |
| 6 | シフトに開始/終了時刻 | 中 | **人時売上高**（3,000-5,000円のベンチマークと比較可能に） |
| 7 | 時給マスタ | 中 | 人件費率（25-30%目安と比較） |
| 8 | 月次の仕入合計 1行 | 中 | 原価率、月次FL比率（60%目安と比較） |
| 9 | 家賃 | 極小 | FLR（70%目安）、R/売上（10%以内） |

**1〜4 だけで、業界標準指標のうち「席効率・予約・機会損失」の全域がカバーできる。** 6〜9 は会計側の話で、オーナーが非エンジニアであることを考えると「月1回、月次で4つの数字を入力する画面」に集約するのが現実的。日次の原価管理は個人店では破綻する。

---

## 8. スマホ表示への含意

オーナーはスマホで見る。上記の指標を全部並べるのは失敗する。**「最も目安から乖離している指標から1つずつ取り組む」のが改善の定石**（[カチプロ](https://pro-marketing.jp/restaurant/insyoku-keiei-kpi-guide/)）なので、UI は「今日の数字」ではなく「業界目安からの乖離が大きい順に3つ」を出す設計が指標体系と整合する。

現時点で目安と比較できるのは実質 **坪月商・従業員1人当たり日商・予約充足率・RevPASH（自店時系列）** の4つ。seat_log が30営業日たまった時点で **客単価・回転率・座席稼働率・平均滞在時間** の4つが加わり、そこで初めて「水木の谷」の正体が診断できる。

---

## Sources

**FL・原価・人件費・利益率**
- [Airレジマガジン: 飲食店のFLコスト・FL比率とは](https://airregi.jp/magazine/guide/2259/)
- [中小企業診断士が解説: 飲食店のFL比率](https://tsuyocon.com/fl-hiritu-kaizen/)
- [テンポケイエイ: FL比率 業態別目安](https://tenpo-keiei.com/management/article-2dca)
- [厨房ベース: FLコスト適性値と計算方法](https://chubou-base.com/blog/fl-cost/)
- [スマレジ akinai-lab: 居酒屋の原価率](https://akinai-lab.smaregi.jp/operation/izakaya-costrate/)
- [カメヤ: 居酒屋・バル・バーの原価率目安](https://www.kameya.co.jp/pro-tips-basics-2/)
- [freee: 飲食店の原価率](https://www.freee.co.jp/kb/kb-hanbai-kanri/restaurant-cost-price/)
- [テンポスフードメディア: 居酒屋のメニュー別原価率](https://www.tenpos.com/foodmedia/newstrend/29033/)
- [スマート飲食経営: 人件費率は何％が適正か](https://smasel.com/media/restaurant-labor-cost-ratio/)
- [LEAP: 人件費率の目標設定](https://leap-it.jp/newton/column/personnel-costs/)
- [INVOY: 人件費率 目安30%の罠](https://go.invoy.jp/how-to-invoice/)
- [freee: 飲食店の利益率の平均](https://www.freee.co.jp/kb/kb-accounting/restaurant-profit-margin/)
- [OpenKitchen: 利益率の目安 業態別](https://www.openkitchen-app.jp/blog/restaurant-profit-margin-guide)
- [マネーフォワード: 利益率と損益分岐点](https://biz.moneyforward.com/restaurant/basic/469/)
- [POS+: 飲食店の損益分岐点](https://www.postas.co.jp/makesmiles/2767/)
- [飲食店ドットコム: 損益分岐点の計算方法](https://www.inshokuten.com/foodist/article/4714/)

**生産性**
- [飲食店ドットコム: 人時売上高の目安・労働分配率](https://www.inshokuten.com/foodist/article/4468/)
- [食べログ オーナーズブログ: 人時売上高](https://owner-blog.tabelog.com/keiei/post-7.html)
- [花王プロフェッショナル: 人時売上高という経営指標](https://pro.kao.com/jp/food-biz-support/management/business-column/013/)
- [canaeru: 人時売上高の目安と人員数の決め方](https://canaeru.usen.com/opening/zyunbi441.html)
- [chef-link: 人時生産性](https://chef-link.com/business/journal/restaurant-jinji-productivity/)
- [飛鳥フードコンサルティング: 労働分配率](https://asuka-food-consulting.com/roudoubunpairitu/)
- [freee: 業種別 労働分配率](https://www.freee.co.jp/kb/kb-accounting/labor-share/)
- [オーダーアール: スタッフ人数の適正](https://orderr.biz/media/how-to-caliculate-number-of-restaurant-staff/)
- [バルテック: 適正なスタッフ数の決め方](https://www.webjapan.co.jp/shop-opening/number-of-employees/)

**席効率・RevPASH**
- [Cornell eCommons: Restaurant Revenue Management (Kimes)](https://ecommons.cornell.edu/bitstreams/56f1b36d-beb8-42fb-aeea-9fdb59be6c29/download)
- [Cornell: Restaurant Revenue Management at Chevys — Best Table Mix](https://ecommons.cornell.edu/server/api/core/bitstreams/f812c462-85df-4ce8-83d4-898868776c81/content)
- [Cornell: Accurately Estimating Time-Based Restaurant Revenues Using RevPASH](https://ecommons.cornell.edu/entities/publication/145baa88-8ed3-47eb-84ea-93e442ec0056)
- [eCornell: Restaurant Revenue Management](https://ecornell.cornell.edu/certificates/hospitality-and-foodservice-management/restaurant-revenue-management/)
- [7shifts: RevPASH for Restaurants](https://www.7shifts.com/blog/revpash-for-restaurants/)
- [eatapp: How to use the RevPASH formula](https://restaurant.eatapp.co/blog/revpash-formula)
- [SevenRooms: The Capacity Myth — Why RevPASH Matters More Than a Full Dining Room](https://sevenrooms.com/blog/restaurant-revpash/)
- [altexsoft: What is RevPASH?](https://www.altexsoft.com/glossary/revpash/)
- [Black Box Intelligence: Revenue Per Available Seat Hour](https://blackboxintelligence.com/resources/restaurant-glossary/revenue-per-available-seat-hour/)
- [REMS: RevPASH — the unknown but most effective restaurant KPI](https://www.remshospitality.com/blog/revpash-the-unknown-but-most-effective-restaurant-kpi)
- [HappyChef: RevPASH — 5 Levers to Lift Revenue Per Seat](https://happychef.cloud/en/blog/finance/revpash-restaurant-kpi.html)
- [Hospitality Net: Reevaluating the RevPASH Formula](https://www.hospitalitynet.org/opinion/4117170.html)
- [Journal of Revenue and Pricing Management: Reevaluating the RevPASH formula](https://link.springer.com/article/10.1057/s41272-023-00446-6)
- [ScienceDirect: New performance indicators — ProPASH and ProPASM](https://www.sciencedirect.com/science/article/abs/pii/S0278431916303140)
- [Academia: Is RevPASH the best performance indicator?](https://www.academia.edu/71728727/Is_RevPASH_the_best_performance_indicator_for_restaurant_revenue_management)
- [月刊ホテレス: レストランのレベニューマネジメント](https://www.hoteresonline.com/articles/6490)
- [マネーフォワード ERP: レベニューマネジメントとは](https://biz.moneyforward.com/erp/basic/3255/)
- [Square: 計算式で攻略！飲食店の回転率](https://squareup.com/jp/ja/townsquare/how-to-calculate-restaurants-turnrate-effect)
- [飲食開業のミカタ: 回転率と客席稼働率](https://insyoku-mikata.vector.co.jp/posts/168/)
- [店舗買取り.com: 飲食店の回転率](https://www.k-tenpo.com/column/319/)
- [canaeru: 最適な席数と回転率の計算式](https://canaeru.usen.com/diy/opening/p959/)
- [iPad Solution Lab: 客席回転率と稼働率](https://lab.ipad-solution.com/increased-sales/)
- [日清オイリオ: 回転率向上のノウハウ](https://foodservice.nisshin-oillio.com/library/2023-010/)
- [レストランスター: 平均滞在時間](https://res-star.com/archives/column/dwell-time)
- [neo-emotion: 居酒屋の平均滞在時間](https://neo-emotion.jp/izakaya-aberage-time/)

**売上分解・坪月商・席数設計**
- [データのじかん: 飲食業のKPIとKPIロジックツリー](https://data.wingarc.com/kpilogictreeofrestaurantindustry-32909)
- [ユビレジ: 客数と客単価](https://ubiregi.jp/pos-regi-guide/kyakusu_kyakutanka)
- [カチプロ: 飲食店の経営分析に使う指標一覧](https://pro-marketing.jp/restaurant/insyoku-keiei-kpi-guide/)
- [マネーフォワード: 坪売上・坪月商](https://biz.moneyforward.com/restaurant/basic/1678/)
- [freee: 坪月商とは](https://www.freee.co.jp/kb/kb-hanbai-kanri/area-monthly-sales/)
- [マネーフォワード: 飲食店の坪単価](https://biz.moneyforward.com/restaurant/basic/3862/)
- [bukennavi: 家賃の適正な売上](https://bukennavi.jp/kanto/opening/knowhow/synthesis9/41)
- [飲食店ドットコム: 厨房面積比率と客席数の目安](https://www.inshokuten.com/bukken/media/431)
- [canaeru: 理想の席数・厨房面積比率](https://canaeru.usen.com/diy/operation/p40/)
- [居酒屋のビジネスモデル: 開業資金・利益率・FL比率](https://insyoku-portal.jp/gyoutai/izakaya/)
- [東京居抜き物件ニュース: 居酒屋の売上平均](https://godproperty.jp/news/method/13122/)

**顧客・リピート・LTV**
- [ぐるなび通信: リピート率・リピーター率の計算式と平均](https://pro.gnavi.co.jp/magazine/t_res/cat_3/a_4237/)
- [テンポミル: 飲食店のリピート率の平均](https://note.com/tenpomiru/n/nc2ad5a425758)
- [オーダーアール: リピート率の平均と調べ方](https://orderr.biz/media/how-to-increase-the-repeat-rate-at-restaurants/)
- [ONE'S: 新規顧客と常連客の売上比率の理想](https://one-s.co.jp/blog/sales/sales-ratio)
- [サングローブ: パレートの法則とリピート率](https://www.sungrove.co.jp/repiat_attract/)
- [コラボパートナー: 3回安定10回固定の法則](https://collabopartner.com/2025/08/12/restaurant-customer-retention-strategy-3-visit-10-visit-rule/)
- [繁盛マーケティング: LTVとは](https://sushi-marketing.com/marketing/about-ltv)
- [SATORI: LTV（顧客生涯価値）](https://satori.marketing/marketing-blog/ltv/)

**予約・ノーショー**
- [TableCheck: 飲食店における無断キャンセル・ノーショー速報レポート](https://www.tablecheck.com/ja/company/press/no-show-survey-2017/)
- [経済産業省 METI Journal: 無断キャンセルが引き起こす負のスパイラル](https://journal.meti.go.jp/p/8662/)
- [経済産業省 No show 対策レポート 2018（PDF）](https://www.aichi-inshoku.or.jp/ai_cms/wp-content/uploads/2018/11/444fac2ea9f294cc5d5dbe02557ee654.pdf)
- [TableCheck 第3回調査: 無断キャンセル理由トップは「とりあえず予約」](https://prtimes.jp/main/html/rd/p/000000044.000023564.html)
- [飲食店ドットコム: 飲食店の無断キャンセル実態](https://www.inshokuten.com/foodist/article/5577/)
- [NIKKEI COMPASS: 7割の飲食店が無断キャンセル対策を実施せず](https://www.nikkei.com/compass/content/PRTKDB000000032_000023564/preview)
- [ebica: 飲食店予約レポート2025](https://www.ebica.jp/news/press/reservation-report-2024-detail/)
- [トレタ: 年末の電話予約比率48.5%](https://prtimes.jp/main/html/rd/p/000000083.000038464.html)
- [飲食店ドットコム: 予約管理・顧客管理の実態調査](https://www.inshokuten.com/research/magazine/article/68)
- [ebica: ネット予約セミナーレポート（リードタイム）](https://www.ebica.jp/column/seminar-report/postas201117/)
- [トレタ: 予約管理システムの分析・レポート機能](https://dx.bizocean.jp/category/appointment/toreta_AP/)
- [アールリザーブ: 飲食店の予約は何日前がベストか](https://r-reserve.com/column/restaurant-reserve-daysbefore/)
- [Somewhere: 予約管理と機会損失](https://somewhereltd.jp/info/?p=415)

**海外ベンチマーク**
- [Lightspeed: 22 Restaurant KPIs to Track](https://www.lightspeedhq.com/blog/restaurant-kpis/)
- [Whipplewood: Restaurant Financial Benchmarks 2026](https://whipplewood.com/insights/financial-benchmarks-for-restaurants/)
- [ChowNow: Restaurant Industry Benchmarks](https://get.chownow.com/blog/restaurant-industry-benchmarks/)
- [NetSuite: 16 Critical Restaurant Benchmarks](https://www.netsuite.co.uk/portal/uk/resource/articles/erp/restaurant-benchmarks.shtml)