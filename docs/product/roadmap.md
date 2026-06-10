# ZeroKey Family 商用リリースロードマップ

商用リリースまでの全体ロードマップ兼リリースゲートの正本。MVP ではなく、モバイル配布・暗号設計・バックエンド・運用・セキュリティ・プライバシー・法務・サポート・障害対応まで含める。

正本 Issue: https://github.com/susumutomita/ZeroKeyFamily/issues/1

## 原則

- 生体・声・顔の「本物判定」を信頼の根にしない。
- 秘密鍵をサーバーへ平文で預けない。
- 承認署名は対象・金額・送金先・理由・期限・nonce・依頼者を束縛する。
- 個人情報・家族関係・確認履歴をパブリックチェーンへ保存しない。
- 暗号方式は自作せず、標準・監査済みライブラリを利用する。
- 高齢者を含む利用者が誤解しない表示を、暗号強度と同じ優先度で扱う。

## フェーズ構成

### Phase 0: プロダクト定義（本リポジトリの現フェーズ）

| 成果物 | 状態 | Issue |
| --- | --- | --- |
| ビジョン・Trust Claims・スコープ・用語集 | 完了（[vision.md](./vision.md) / [trust-claims.md](./trust-claims.md) / [scope-and-non-goals.md](./scope-and-non-goals.md) / [glossary.md](./glossary.md)） | https://github.com/susumutomita/ZeroKeyFamily/issues/2 |
| ユーザージャーニー・ワイヤーフレーム・安全文言・失敗時挙動・ユーザビリティテスト計画 | 完了（[user-journeys.md](./user-journeys.md) / [wireframes.md](./wireframes.md) / [safety-copy-guide.md](./safety-copy-guide.md) / [failure-and-offline-behaviors.md](./failure-and-offline-behaviors.md) / [usability-test-plan.md](./usability-test-plan.md)） | https://github.com/susumutomita/ZeroKeyFamily/issues/3 |
| 脅威モデル | 未着手（Issue 作成時にここへ追記する） | 未作成 |

### Phase 1: 初期商用リリース

[スコープと非目標](./scope-and-non-goals.md) の Phase 1 範囲を実装する。

- 暗号設計: 鍵生成・署名・検証・失効のプロトコル仕様。W3C Verifiable Credentials Data Model 2.0 / OpenID for Verifiable Presentations 1.0 への準拠方針。
- モバイル: iOS / Android アプリ。Secure Enclave / Android Keystore・StrongBox での鍵保管。
- バックエンド: 確認要求の配送・検証・監査ログ・失効管理。
- 安全機構: 高リスク操作の複数人承認、待機時間、緊急停止、ソーシャルリカバリー。
- 第 1 回・第 2 回ユーザビリティテストの合格。

### Phase 2: 拡張（実用性評価を経て判断）

- ZKP による Trust Circle membership の選択的開示の実装・検証。
- FHE の実用性評価と本番導入可否の判断。
- ブロックチェーン Trust Registry の必要性実証（個人情報を置かない構成のみ）。

## リリースゲートチェックリスト

初期商用リリース（Phase 1）は、「プログラム全体の完成条件」節を除く以下の全項目を通過するまで行わない。「プログラム全体の完成条件」は Issue 1 のクローズ条件であり、Phase 2 で判断する（[スコープと非目標](./scope-and-non-goals.md) のとおり Phase 1 には含めない）。各項目は対応 Issue 作成時にリンクを追記する。

### プロダクト

- [x] プロダクト要件・非目標が合意されている（Issue 2 成果物）。
- [ ] 脅威モデルが合意されている。
- [x] ユーザージャーニーと誤用耐性 UX が定義されている（Issue 3 成果物）。
- [ ] 高齢者ユーザビリティテストが合格基準を満たしている（[計画](./usability-test-plan.md)）。

### 機能（初期商用リリース）

- [ ] iOS / Android で家族登録・確認要求・端末署名・検証・失効・復旧が完結する。
- [ ] 高リスク操作に対する複数人承認とソーシャルリカバリーが実装されている。

### プログラム全体の完成条件（Phase 2 以降・初期商用リリースをブロックしない）

- [ ] ZKP による Trust Circle membership の選択的開示が実装・検証されている。
- [ ] FHE 活用は実用性評価を経て本番導入可否が判断されている。
- [ ] ブロックチェーンは個人情報を置かない Trust Registry として必要性が実証されている。

### セキュリティ・プライバシー

- [ ] OWASP MASVS / MASTG 相当の要求を満たす。
- [ ] NIST SP 800-63B 相当の認証要求を満たす。
- [ ] 独立した暗号レビューを通過している。
- [ ] 侵入テストを通過している。
- [ ] [失敗時・通信断時の挙動一覧](./failure-and-offline-behaviors.md) の「実装欠陥として扱う挙動」が検証で再現しない。

### 運用

- [ ] SLO・監視・アラートが稼働している。
- [ ] バックアップ・災害復旧の訓練が完了している。
- [ ] インシデント対応手順とオンコール体制が稼働している。

### 配布・法務・サポート

- [ ] App Store / Google Play の審査・プライバシー申告が完了している。
- [ ] 利用規約・プライバシーポリシーが Trust Claims と整合している。
- [ ] サポート体制（詐欺疑い時の相談導線を含む）が完成している。
- [ ] すべての画面文言・販促表現が [Trust Claims](./trust-claims.md) との整合レビューを通過している。

## 参照標準

- W3C Verifiable Credentials Data Model 2.0
- OpenID for Verifiable Presentations 1.0
- OWASP MASVS / MASTG
- NIST SP 800-63B
- Apple Secure Enclave / Keychain
- Android Keystore / StrongBox

## 関連文書

- [プロダクトビジョン](./vision.md)
- [Trust Claims（信頼保証と限界）](./trust-claims.md)
- [スコープと非目標](./scope-and-non-goals.md)
- [用語集](./glossary.md)
