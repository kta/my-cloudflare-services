---
name: patent-assess
description: 典拠（patent_research）の待ち行列から特許性の判断の仕事を拾い、照合済みの典拠だけを根拠に、新規性と進歩性を審査基準の型で論じる。
---

# patent-assess — 新規性と進歩性を、審査基準の型で論じる

あなたは審査官と同じ土俵に立つ。感想ではなく、**審査基準の判断枠組みに沿って**論じる。

## 絶対の前提

**照合が通っていない典拠（`quoteCheck !== 'verified'`）を根拠にしてはならない。**
`GET $BASE/api/matters/:id/evidence` を読み、`quoteCheck` が `verified` のものだけを使う。
それ以外は「まだ確かめられていない」ものであり、論証に使うと嘘になる。

## 手順

### 1. 材料を集める

- `GET $BASE/api/matters/:id/elements` — 構成要件と、要件ごとの照合済み典拠の数
- `GET $BASE/api/matters/:id/evidence` — 典拠（`quoteCheck` と `review` を必ず見る）
- `GET $BASE/api/matters/:id/searches` — **どの範囲を見たか**。見ていない範囲を「無い」と言わない

### 2. 新規性（特許法29条1項）

**単一文献主義。** 1 つの引用発明だけで判断する。副引用も動機付けも出てこない。

1. 引用発明を認定する（1 つの公報）
2. 請求項に係る発明と対比し、**構成要件ごとに**一致点と相違点を出す
3. 相違点が 1 つでもあれば新規性はある

```sh
curl -s -X POST "$BASE/api/matters/$MATTER/assessments" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"kind":"novelty","primaryRef":"特開2018-134274","conclusion":"risky",
       "reasoning":"要件A・B・Cは【0032】【0033】に開示されている。要件Dは開示されていない（相違点）。"}'
```

`secondaryRefs` や `motivationType` を付けると契約が拒否する。それは進歩性の議論である。

### 3. 進歩性（特許法29条2項）

順序を守る。

1. **主引用発明を選ぶ** — 請求項に係る発明と最も近いもの
2. **相違点を確定する** — 構成要件のうち、主引用に開示されていないもの
3. **副引用発明を探す** — その相違点を埋める文献
4. **組合せの動機付けを検討する** — 次の 4 類型のどれに当たるか
   - `technical_field` 技術分野の関連性
   - `problem` 課題の共通性
   - `function` 作用・機能の共通性
   - `suggestion` 引用発明の内容中の示唆
5. **有利な効果を検討する** — 進歩性を肯定する方向に働く
6. **阻害要因を検討する** — 組合せを妨げる事情。**ここを空のまま結論を出さない**
7. 設計変更・単なる寄せ集めに当たらないかを見る（`negativeType`）

```sh
curl -s -X POST "$BASE/api/matters/$MATTER/assessments" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"kind":"inventive_step","primaryRef":"特開2018-134274","secondaryRefs":["特開2019-000001"],
       "motivationType":"problem","advantageousEffects":"...","hindrance":"...",
       "conclusion":"likely_patentable","reasoning":"..."}'
```

`conclusion` を `undetermined` 以外にするなら `primaryRef` が要る（契約が守る）。

### 4. 論証の書き方

`reasoning` には、**構成要件の記号と公報番号と段落番号**を必ず入れる。

> 主引用発明（特開2018-134274）は、要件 A を【0031】、要件 B を【0032】に開示する。
> 要件 C は開示されていない。副引用発明（特開2019-000001）は【0015】で…（略）。
> 両者は「装用者の眼の状態から光学設計を決める」という課題を共通にするため、
> 課題の共通性による動機付けがある。ただし副引用は研磨工程の発明であり、
> 撮像系を持たないため、主引用へ適用するには撮像手段を別途足す必要がある（阻害要因）。

**典拠に無いことを書かない。** 書きたいことに典拠が無ければ、それは
`patent-search` の仕事に戻して探す。

### 5. まとめて報告する

- 構成要件ごとの一致・相違の表
- 新規性の結論と、その根拠になった公報の段落
- 進歩性の結論と、動機付けの類型、有利な効果、阻害要因
- **見ていない範囲**（実行していない検索式・コーパスに全文が無い公報）

## やってはいけないこと

- 照合が通っていない典拠を根拠にする
- 「一般に知られている」「当業者には自明である」を典拠なしで書く
- 阻害要因の欄を空のまま `likely_patentable` と結論する
- 新規性の議論に副引用を持ち込む
