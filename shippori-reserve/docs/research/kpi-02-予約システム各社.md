## 0. 調査の制約（先に）

この環境の egress proxy が sevenrooms.com / toreta.in / support.opentable.com / tablecheck.com / ebica.jp / helpdesk.resy.com など**ベンダーのヘルプページを全てブロック**した（WebFetch は全ドメインで `EGRESS_BLOCKED`）。したがって以下は WebSearch 経由のスニペット＋公式ヘルプ記事タイトルからの再構成。**レポート名・指標名のレベルは信頼できるが、カラム名・画面キャプチャのレベルは取れていない**。ここは正直に言っておく。

---

## 1. 各社が実際に出しているレポート（名前レベル）

### OpenTable / GuestCenter（最も画面名が具体的に取れた）
ヘルプセンターに個別記事として存在が確認できたレポート:

| レポート名 | 中身 |
|---|---|
| **Cover Trends Report** | 期間内の seated covers の推移。「店の成長を時系列で見る一連のレポート」 |
| **Turn Times Analysis** | 予約タイプ・予約経路・パーティサイズ・シフトグループ別の**実測ターンタイム**。「想定2時間に対し実測1時間25分」のようなズレを出す |
| **Guest Frequency (Visit Frequency) Report** | 来店回数別の顧客リスト＋連絡先。初回客／リピーターの区分 |
| **Reservation Sources / Interactive Performance** | 予約経路別を 7 / 30 / 365 日で追う |
| **Shift Overview（シフト前サマリー）** | 当日の営業前ブリーフィング |
| **Server Performance** | サーバー別のカバー数・客単価・レビュー |
| **Flow Controls** | 15分スロットごとの最大組数・最大人数（分析ではなく設定だが、ペーシングの前提） |
| **Group Reporting: Restaurant Trends / Guest Export** | 多店舗比較・顧客エクスポート |

2018年の BI スイート発表時の言い方が象徴的で、「**shift occupancy analysis / booking insights / referral insights / monthly business reports / Restaurant Owner app**」という括り。つまり OpenTable は「シフト単位の埋まり具合」「予約がどこから来たか」を柱に置いている。

### SevenRooms
「**50+ の指標**」を謳う。名前が取れたもの: cancellation rate / no-show rate / repeat visit percentage / spend patterns / promotions。ウェイトリスト側に専用レポートがあり **quote accuracy（案内した待ち時間の的中率）／average wait time／abandonment rate／return time**。レポートの**保存・定期メール送信**（週次で店長に自動送付）が売り。

### Resy OS
covers / repeat guests / guest surveys & ratings / waitlist performance / **turn times** / monthly guestbook / **projected covers（予測カバー数）**。「デマンドがシフト中のどこで立ち上がるか」を見せてキッチン準備とペーシングに使わせる。

### Toast（POS側）
**9カテゴリ・40本以上**（Sales / Labor / Menus / Payments / Cash and Loss Management / Accounts / Kitchen Operations / Marketing / Other）。ただし**オーナー向けの入口は週次ダッシュボード1枚**で、そこに出るのは **sales / labor / guest counts / menu performance の4つだけ**。40本作っておいて入口は4指標、という設計は参考になる。

### トレタ（日本・最も近い規模帯）
トレタマネージャーの集計・分析で名前が取れた項目:
- **予約経路**（電話／トレタウェブ予約／グルメサイト／Googleで予約／ウォークイン の内訳）
- **客数**（日別・月別・**時間帯別**・**曜日別**・**何日前に予約しているか**）
- **来店回数**（常連比率、その推移）
- **キャンセル**（キャンセル数・キャンセル率）
- **コース**（コース数・金額）
- カスタムパラメーター（ウェブ予約の貼り付け先別効果）

### TableCheck
BIツール「**Insight**」。総売上／日平均売上／**時間帯別売上**／**meal・pax別売上**／決済手段別。顧客側は 来店回数・最終来店日・利用金額・予約経路・客単価 を掛け合わせてグラフ化。予約経路を「平均客単価・予約数・**予約リードタイム**・キャンセル率」でランキング。**デイリーレポート／月間レポートをボタン1つで印刷**、という機能があるのが日本的で示唆的。

### ebica / レストランボード
ebica は「ダッシュボード機能」と言うだけで指標名が公開されていない（強みはサイトコントローラーとAI電話応対で、分析は主戦場ではない）。レストランボードは**台帳単体では分析がほぼ無く、Airレジ連携で初めて売上・客数・客単価・回転率**が出る。＝ 予約台帳だけでは客単価が出せないのは業界共通の構造。

---

## 2. 席管理データ（着席・退席）から実際に何を導いているか

ここが本題。着席/退席の時刻ログから業界が作っているものは、実質**5つしかない**。

1. **ターンタイム（実測滞在時間）を人数別・時間帯別・曜日別に出す** → 予約枠の長さを実測で設定し直す。OpenTable の Turn Times Analysis がまさにこれ。業界平均（2名50分、6名75〜90分、ランチ2名45分）ではなく「**自店で2週間実測して自分の表を作れ**」というのが各社の指導。
2. **席稼働率／卓稼働率**（seat occupancy % / table occupancy %）。分母は **seat-hours（席数×営業時間）**。Avero は table と seat を明確に別指標として分けている。ベンチマークは 75〜80%、70%割れは集客不振、90%超は容量不足のサイン。
3. **RevPASH**（売上 ÷ 席時間）。「稼働率95%でも客単価が低く滞在が長ければ、稼働70%でRevPASHが高い店に負ける」という使われ方。ただし**時間帯別の売上が必要**。
4. **ペーシング／フロー制御**。15分スロットあたりの最大カバー数（OpenTable の既定は 15分で30カバー）。covers per hour の目安はファインダイニング5〜10、カジュアル15〜30、ファストカジュアル40〜80。
5. **卓ステータス由来の予測ターン**（available / seated / dessert / check dropped / bussed）。会計前の時点で「あと何分で空く」を予測してホストに出す。特許まで出ている領域。

効果として具体的な数字が出ていた事例:「**テーブル構成を実際のパーティサイズ分布に合わせたら、ピーク時の席稼働が 50%→59%、平均滞在が 53分→51分**」。これは席稼働データの一番わかりやすい使い道。

---

## 3. 「使われている」機能と「使われていない」機能

### 使われている
- **シフト前の当日サマリー**（今日の予約組数・人数・ピーク時刻）— どの製品も第一画面
- **ペーシング設定**（キッチンを詰まらせない）
- **予約経路別の件数**（どこに金を払うべきかの判断に直結）
- **no-show／当日キャンセル率**（リマインドで 15-20% → 5% 未満に落ちる、という改善実績が語られる）
- **実測ターンタイム**（予約枠の設定に跳ね返る＝行動が変わる）

### 使われていない（証拠つき）
- **顧客台帳の中身**。トレタが自ら「**『顧客台帳』使えてますか？活用度判定のチェックリスト付き**」というコンテンツを出し、「チェック数0〜3：これからの期待大」「最初から全部やろうとすると慣れない内にやめてしまう心配がある」と書いている。ベンダーがこう書くということは、**手入力に依存する顧客データは現場で埋まらないのが常態**ということ。
- **50+指標のBI**。SevenRooms について「**3店舗以上のグループ向けに作られており、単独店にとってはフルに使われない機能に対してエンタープライズ価格を払うことになる**」という評価が出ている。
- **サーバー別パフォーマンス**（スタッフが数名の店では意味を成さない）
- **多店舗比較・グループレポート**（定義上、1店舗には存在しない）
- **マーケティングROI／キャンペーン分析**（母数が足りない）

構造的な理由もひとつ。「メール・モバイル配信は最もコスパの良いチャネルなのに**一貫して過小利用されている**」という指摘があり、逆に言えば**取得が自動なデータは使われ、手入力が必要なデータは使われない**。これが唯一の再現性ある法則。

---

## 4. 小規模向け vs 大型向けで指標は違うか

違う。明確に3層ある。

| | 単独小規模店 | 単独大型店・人気店 | チェーン／グループ |
|---|---|---|---|
| 主目的 | **今日を回す** | **1回転増やす** | **店舗間の差を潰す** |
| 中心指標 | 当日の予約組数・人数、曜日別売上、経路別件数 | ターンタイム、席稼働率、ペーシング、RevPASH、no-show率 | 店舗横断比較、サーバー別、PMIX、労務比率 |
| データ源 | 予約台帳のみ | 台帳＋着席ログ＋POS | 全社統合BI |

日本の比較記事も同じ切り分けをしている:「大規模店では複数予約の同時受付・多店舗一元管理が必要」「小規模店向けは必要最低限の予約受付・管理、コストを抑えるため余計な機能は削減」。Square と Lightspeed の対比も同じで、**「Square は深い分析を必要としない小規模店向け」**という位置づけ。

---

## 5. しっぽり亭が真似すべきもの（優先度順）

**A. 今すぐ／既存データだけで出せる**

1. **曜日 × 週の日商と目標差**（894日ある）。曜日別平均はもう出ている。次は「**この4週の水曜の平均 vs 過去2年の水曜の平均**」という比較。水木が谷という既知の事実を、施策の前後で追えるようにする。
2. **予約経路別の件数・人数**（トレタの「予約経路」相当）。既に `reservation_source` enum がある。ただし**率ではなく実数で出す**。月40件で「電話が32.5%」は意味がない。
3. **予約リードタイム（何日前に予約されたか）の分布**。トレタも TableCheck も持っている。これは `created_at` と `starts_at` の差で今すぐ計算できる。**繁忙日の予約が何日前から埋まるか**が分かれば、席を止める判断ができる。
4. **no-show／当日キャンセル率**。`reservation_status` に `no_show` がある。月次の実数で。

**B. seat_log が貯まってから（最重要）**

5. **日次の延べ着席人数＝客数の実測**。これが取れると初めて **客単価 = 日商 ÷ 客数** が出る。今のシステムで一番価値が高いのはこれ。ただし後述の罠あり。
6. **人数別の実測滞在時間**（OpenTable の Turn Times Analysis の縮小版）。設定画面 S11 の「標準滞在時間」を、勘ではなく実測で置き換える。これが**行動が変わる唯一の分析**。
7. **時間帯別の同時着席人数カーブ**（30分刻み）。ピークが19:30なのか20:30なのかで、シフトの入り時刻が変わる。確定シフトのデータと突き合わせられる。
8. **席種別の稼働**（カウンター／テーブル／個室のどれが余っているか）。

---

## 6. 規模的に不要／持ち込むと害になるもの

| 持ち込むべきでないもの | 理由 |
|---|---|
| **RevPASH** | 時間帯別売上がない（会計データが日単位）。分子を作れないのに指標だけ置くと、推定の推定になる |
| **席稼働率（36席を分母にした%）** | **テーブル/個室は「席」ではなく「卓」で埋まる**。4名が6人卓を占有したら残り2席は物理的に売れない。36席分母の稼働率は永久に低く出て、意味のない罪悪感だけ生む。→ 測るなら「空席」ではなく**「死に席」（卓を占有したが使われなかった席数）**を出すべき |
| **サーバー別パフォーマンス** | スタッフ数名。人間関係を壊すだけ |
| **ペーシング／フロー制御** | 1日7件の予約に15分スロット制限は不要。過剰装備 |
| **ウェイトリスト分析**（quote accuracy / abandonment） | 行列が発生しない規模 |
| **メニューエンジニアリング／PMIX** | POSの明細データがそもそもない |
| **多店舗比較・グループレポート** | 1店舗 |
| **AI需要予測** | 894日は日次としては十分だが、**曜日×月×繁忙フラグで割ると各セル10件台**。前年比の方が誠実 |
| **顧客CRM（常連ランク、来店回数別セグメント）** | トレタ自身が「使えていない店が多い」と認めている領域。電話番号ベースで自動的に貯まる分だけ持ち、**キャンペーン機能は作らない** |
| **50+指標のダッシュボード** | Toast ですらオーナーの入口は4指標 |

---

## 7. 線引きのルール（3つだけ）

1. **手入力が必要な指標は作らない**。seat_log のタップですら続かないリスクがある。続かなかった時に**壊れる指標を主要画面に置かない**（seat_log が3日空いても、日商グラフは無傷でなければならない）。
2. **分母が月30件を切る切り口は率で出さない**。実数のみ。「キャンセル率12.5%」（8件中1件）は嘘に近い。
3. **行動が変わらない指標は出さない**。「席稼働率62%」を見て店長が明日何を変えるのか答えられないなら、その指標は削る。逆に「6名の平均滞在が127分だった → 6名の予約枠を120分から135分にする」は行動が変わる。

---

## 8. seat_log の設計に対する具体的な要求（研究から逆算）

- **物販・催事の売上を分離するカラムが要る**。7/26 のうなぎ太巻き 68万（うち物販62.3万）を含んだまま「日商 ÷ 客数」を計算すると、客単価が跳ね上がって全ての分析が壊れる。**店内飲食売上と物販売上は別カラムで持つべき**。これは seat_log 以前の話で、最優先。
- **退席タップは忘れられる**。業界の卓ステータス（seated / dessert / check dropped / bussed）を真似する必要はないが、**「立った時刻が null のまま閉店を跨いだレコード」を営業時間終了で自動クローズし、それを「推定」フラグで区別**しておく。区別しないと滞在時間の平均が汚染される。
- **最初の3ヶ月は集計するだけで判断しない**。36席 × 6時間 = 216席時間/日、月25日で5400席時間。人数別に割ると6名以上のサンプルは月に数十件しかない。「2週間実測して自分の表を作れ」という業界の指導は、1日数百カバーの店の話。しっぽり亭は**3ヶ月で1シーズン分**。

---

## 出典

- [Utilize Turn Time Analysis reports to maximize seating — OpenTable Support](https://support.opentable.com/s/article/Turn-Times-Analysis-for-GuestCenter?language=en_US)
- [Reports: Cover Trends Report in OpenTable](https://support.opentable.com/s/article/Cover-Trends-Report-in-GuestCenter?language=en_US)
- [Reports: Guest Frequency Report in OpenTable](https://support.opentable.com/s/article/Visit-Frequency-Report-in-GuestCenter?language=en_US)
- [Set up flow controls to manage the pace of reservations — OpenTable Support](https://support.opentable.com/s/article/flow-controls?language=en_US)
- [Restaurant Analytics Software - Reporting Dashboards & Insights — OpenTable](https://www.opentable.com/restaurant-solutions/products/features/reporting/)
- [OpenTable Unveils Business Intelligence Suite for GuestCenter](https://www.prnewswire.com/news-releases/opentable-unveils-business-intelligence-suite-for-guestcenter-300648508.html)
- [Restaurant Reporting and Business Analytics Software — SevenRooms](https://sevenrooms.com/platform/reporting/)
- [5 Keys to Better Waitlist Management — SevenRooms](https://sevenrooms.com/blog/5-keys-to-better-waitlist-management/)
- [The Capacity Myth: Why RevPASH Matters More Than a Full Dining Room — SevenRooms](https://sevenrooms.com/blog/restaurant-revpash/)
- [Restaurant Analytics Software & Reporting — Resy](https://resy.com/join/analytics/)
- [Reporting and Analytics — Resy Helpdesk](https://helpdesk.resy.com/resy-analytics-BJdQMvX8_)
- [Get Started With Analytics and Reports — Toast Support](https://support.toasttab.com/en/article/Getting-Started-with-Analytics-and-Reports)
- [Toast Reporting Dashboard: Weekly Overview — Toast Support](https://support.toasttab.com/en/article/How-to-Use-the-Toast-Reporting-Dashboard)
- [スマートフォンやパソコンで、トレタで貯めたデータを一目で分析！ — トレタ](https://toreta.in/contents/dx/post_1/)
- [トレタ活用ガイド「『顧客台帳』使えてますか？活用度判定のチェックリスト付き」](https://toreta.in/contents/useful/katsuyou_guide001/)
- [攻めるデータ活用 — TableCheck](https://www.tablecheck.com/ja/join/features/analytics/)
- [データ分析ツール「Insight」提供開始 — TableCheck](https://www.tablecheck.com/ja/company/press/insight-launch/)
- [Restaurant Data Analytics for Growth — TableCheck](https://www.tablecheck.com/en/join/features/optimize-business/)
- [【導入検討中の飲食店様へ】「ebica」ダッシュボード機能](https://www.ebica.jp/solution/ebica-dashboard/)
- [レストランボードとは？基本無料の予約台帳アプリの機能・連携サービスを解説](https://pro-marketing.jp/restaurant/yoyaku/restaurant-board/)
- [Basics: Table and Seat Occupancy % — Avero Solution Center](https://averoinc.zendesk.com/hc/en-us/articles/19200870710547-Basics-Table-and-Seat-Occupancy)
- [Seat Utilization — Black Box Intelligence Restaurant Glossary](https://blackboxintelligence.com/resources/restaurant-glossary/seat-utilization/)
- [What is average dining time? — Restaurant Booking System Academy](https://restaurantbookingsystem.com/academy/glossary/average-dining-time/)
- [What is covers per hour? — Restaurant Booking System Academy](https://restaurantbookingsystem.com/academy/glossary/covers-per-hour/)
- [Booking lead time: what it is and why it matters — Restaurant Booking System Academy](https://restaurantbookingsystem.com/academy/glossary/booking-lead-time/)
- [Understand Cover pacing — Hostme Help Center](https://help.hostmeapp.com/en/articles/4473275-understand-cover-pacing)
- [Small Restaurant Seating Layout: Maximize Revenue Per Seat](https://www.superiorseating.com/blog/small-restaurant-seating-layout-guide)
- [Restaurant No-Show Rate: What It's Really Costing You](https://blog.tobeout.com/restaurant-no-show-rate-what-its-really-costing-you/)
- [Postonero vs SevenRooms 比較（単独店に対する評価）](https://www.postonero.com/postonero-vs-sevenrooms/)
- [飲食店向け予約管理システム14選。違いや選び方は？ — アスピック](https://www.aspicjapan.org/asu/article/38823)

参照した社内ドキュメント: `/home/user/abet-news/shippori-reserve/docs/02-screens.md`（S10 集計画面・S11 標準滞在時間）、`/home/user/abet-news/shippori-reserve/docs/03-database.md`（`reservation_source` enum・`seat_units` は C/T1-T3/P1 の5卓構成・`reservation_status` に `no_show` あり）