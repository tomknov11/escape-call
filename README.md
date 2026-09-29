# Escape Call SIP v2

指定した時間後に、iPhone の Linphone に **実際のVoIP着信**を発生させる無料MVPです。

## 現在の固定設定

| 表示 | 用件 |
|---|---|
| SECOM監視センター | アペゼビルの件 |
| ALSOK監視センター | 中央駐車場の件 |
| にしけい監視センター | セントラルビルの件 |

予約時間: **1 / 3 / 5 / 10 / 30 / 60分後**

---

# 仕組み

1. iPhoneのSafari/PWAで「5分後・SECOM」を予約
2. Cloudflare Durable Object Alarmが5分後に起動
3. GitHub Actionsを起動
4. Ubuntu上のbaresipが `sip.linphone.org` から発信
5. iPhone版LinphoneがVoIP着信を受信
6. iOSのCallKit着信UIが表示される

電話番号・Twilio・Apple Developer有料登録は不要です。

---

# 必要な無料アカウント

- Linphone
- GitHub
- Cloudflare

## Linphoneアカウントは4個

### 受信用
iPhoneのLinphoneにログインするアカウント × 1

例:
- `keishi_escape_receiver@linphone.org`

### 発信用
- SECOM用 × 1
- ALSOK用 × 1
- にしけい用 × 1

ユーザー名は任意の英数字で構いません。
表示名はbaresip側から以下を送ります。

- `SECOM監視センター`
- `ALSOK監視センター`
- `にしけい監視センター`

> Linphone側で表示名よりSIP URIが優先される場合があります。その場合は、
> 3つの発信SIP URIをLinphoneの連絡先に上記名称で登録すると安定します。

---

# 1. iPhone設定

1. App Storeから **Linphone** をインストール
2. 受信用Linphoneアカウントでログイン
3. 通知・マイクを許可
4. iOSの設定でLinphoneの通知を許可
5. 一度Linphoneを開いた状態で、別Linphoneアカウントからテスト発信
6. iPhoneに着信UIが出ることを確認

受信URIを控えます。

例:

```text
sip:keishi_escape_receiver@sip.linphone.org
```

---

# 2. GitHubリポジトリ

このフォルダを **public repository** にpushしてください。

Public repository の標準GitHub-hosted runnerは無料で利用できます。

リポジトリの

`Settings → Secrets and variables → Actions → New repository secret`

で以下7個を登録します。

```text
SIP_RECEIVER_URI
SIP_SECOM_USER
SIP_SECOM_PASS
SIP_ALSOK_USER
SIP_ALSOK_PASS
SIP_NISHIKEI_USER
SIP_NISHIKEI_PASS
```

`SIP_RECEIVER_URI` は `sip:xxxx@sip.linphone.org` の形。

ユーザー名には `@linphone.org` を付けず、ユーザー名だけを登録してください。

---

# 3. まずGitHub Actions単体をテスト

GitHub:

`Actions → Escape Call SIP → Run workflow`

source を `secom` にして実行。

成功すると、数秒後にiPhoneへLinphone着信が来ます。

**ここが最重要テストです。**

これが通らない状態ではCloudflare側へ進まないでください。

GitHub Actionsのログに以下が出ればSIP側は概ね正常です。

- registration succeeded / 200 OK 相当
- call connecting
- SIP progress / ringing

---

# 4. Cloudflare Worker

GitHubの Fine-grained Personal Access Token を作成します。

対象repositoryだけを指定し、最低限:

- Actions: Read and write
- Metadata: Read

を許可してください。

Windows PowerShellで:

```powershell
cd scripts
Set-ExecutionPolicy -Scope Process Bypass
.\setup-worker.ps1
```

聞かれるもの:

1. GitHubユーザー名
2. GitHubリポジトリ名
3. アプリ用PIN
4. GitHub PAT

Cloudflare login画面が開くので許可。

最後に:

```text
https://escape-call.xxxxx.workers.dev
```

のようなURLが表示されます。

---

# 5. iPhoneへ追加

SafariでWorker URLを開く。

Safariの共有ボタン:

`ホーム画面に追加`

これでEscape Callがアプリ風に使えます。

---

# 6. 実機テスト

最初は:

- SECOM監視センター
- 1分後

でテスト。

予約後はSafariを閉じても構いません。

約1分後 + GitHub Actions起動時間（通常数秒〜数十秒）でLinphone着信が来ます。

## 時刻精度について

「1分後」は厳密に秒単位ではありません。

Cloudflare alarm起動後にGitHub Actions runnerを確保し、
baresipを起動・SIP登録するため、通常は予約時刻からさらに数秒〜数十秒程度かかります。

---

# 7. キャンセル

予約画面の「キャンセル」を押すとCloudflare Alarmを削除します。

ただし、指定時刻を過ぎてGitHub Actionsが既に起動した後はキャンセルできません。

---

# セキュリティ

- SIPパスワードはGitHub Secretsだけに保存
- GitHub PATはCloudflare Secretだけに保存
- Worker画面/APIはPINで保護
- `.env` やSecretsをGitにcommitしない

このrepositoryをpublicにする場合でも、秘密情報はコードには入れません。

---

# 無料条件

### Linphone
個人向け `sip.linphone.org` SIPサービスを使用。

### GitHub Actions
public repository + standard runnerを使用。

### Cloudflare
Workers Free + SQLite-backed Durable Objectsを使用。

無料枠を超えた場合は、Freeプランでは追加請求ではなく処理が失敗する構成を前提とします。

---

# 制約

この着信は090/080等の公衆電話網の電話ではありません。
インターネット経由のSIP/VoIP着信です。

また、実在企業の電話番号を送信元として偽装する機能はありません。

---

# デバッグ順序

問題が出たらこの順番で切り分けます。

1. Linphone → Linphone の手動通話ができるか
2. GitHub Actionsから1分以内に着信するか
3. Cloudflare WorkerからGitHub workflowが起動するか
4. 予約時刻後に自動着信するか

この順番なら原因を一段ずつ特定できます。


# 検証済み範囲

この配布物について以下をローカルで確認しています。

- Worker JavaScript の構文チェック
- `wrangler.jsonc` のJSONC基本構造
- GitHub Actions YAML の構文パース
- 予約値の固定リストがUIとAPIで一致
- GitHub Secrets名がworkflow内で一致
- 秘密情報がコード・ZIP内に直書きされていないこと

実際のSIP登録・iPhone着信だけは、あなた自身のLinphoneアカウント認証情報が必要なため、
配布物だけでは実通信テストできません。最初の実通信テストは
`Actions → Escape Call SIP → Run workflow → secom`
で行います。
