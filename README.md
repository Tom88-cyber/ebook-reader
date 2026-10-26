# ebook-reader 電子書朗讀

手機用的 TXT 小說閱讀器（網頁 App／PWA），可以閱讀，也可以朗讀。書和進度只存在手機本機，裝好後不需要網路。

## 功能
- 匯入 TXT（自動判斷 UTF-8、Big5、GBK 編碼）或 Word 的 .docx（只取文字；舊版 .doc 要先另存），書架顯示閱讀進度，讀完可以刪除
- Word 裡設成「標題」樣式的段落會當成章節
- 往下滑連續閱讀，自動切章節並產生目錄，記住上次讀到的位置
- 文字大小、行距、黑體／明體、淺色／護眼／深色主題
- 朗讀：語速 0.75x～3x、選擇聲音、標示正在念的句子、點句子從那裡開始念
- 開車模式：黑底大按鈕，螢幕保持常亮
- 藍牙或車用音響的播放、暫停、上一首、下一首鍵可以控制朗讀（上一首／下一首＝上一段／下一段）
- 睡眠定時：15／30／60 分鐘，或讀完這章停止

## 檔案
- `index.html`、`style.css`、`app.js`：主程式
- `sw.js`：離線快取。**改過任何檔案後，要把 `CACHE` 的版本號加一**，手機才會更新到新版
- `manifest.webmanifest`、`icon-*.png`：加到主畫面用的設定與圖示

## 在電腦上測試
```
cd ebook-reader
python -m http.server 8765
```
用瀏覽器開 http://localhost:8765/ ，按 F12 切換成手機尺寸。

## 網站與更新
- 網址：https://tom88-cyber.github.io/ebook-reader/
- 放在公開儲存庫 `Tom88-cyber/ebook-reader`（GitHub Pages，main 分支根目錄），只放這個資料夾的內容。
- 程式改完並 push 到 my-tools 後，在 my-tools 根目錄執行下面這兩行同步到網站（要自己在終端機跑）：
  ```powershell
  $sha = git subtree split --prefix=ebook-reader
  git push https://github.com/Tom88-cyber/ebook-reader.git "${sha}:refs/heads/main"
  ```
- 記得先把 `sw.js` 的版本號加一，手機才會換成新版。

## 已知限制
- 朗讀用的是手機內建語音（Android 是「Google 文字轉語音」）。聲音不夠中文時，到手機「設定 → 協助工具 → 文字轉語音」下載中文語音。
- 網頁朗讀在關掉螢幕後可能會停。開車時建議使用開車模式，讓螢幕保持亮著並接上充電。
