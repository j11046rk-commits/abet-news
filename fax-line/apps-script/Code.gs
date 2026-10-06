/**
 * FAX → LINE 通知 (Apps Script 版)
 *
 * 複合機が Gmail に転送した FAX を拾い、PDF を Drive に保管し、
 * 送信元の情報と中身の画像を LINE に流す。「印刷する」も同じスクリプトが受ける。
 *
 * 旧構成の Make / pdf.co / OneDrive を置き換えたもの。設定は
 * スクリプトプロパティに入れる (値は SETUP.md 参照)。
 */

var LABEL_DONE = 'fax-line-sent';
// 7 日より古いものは拾わない。長期間止まっていた後に再開しても、
// 溜まっていた分が一斉に LINE へ流れ込まないようにするための歯止め。
var SEARCH_QUERY = 'has:attachment filename:pdf "RJOBNUM" -label:' + LABEL_DONE + ' newer_than:7d';
var MAX_THREADS_PER_RUN = 5;
var MAX_IMAGES = 4;          // LINE は 1 回の push で 5 通まで。Flex 1 通 + 画像 4 通。
var GUARD_PREFIX = 'sent:';  // 二重送信よけ。キーは Gmail のメッセージ ID。
var GUARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function prop_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('スクリプトプロパティ ' + name + ' が未設定です');
  return value;
}

/* ------------------------------------------------------------------ 受信 */

/** 時間主導トリガーから呼ぶ入口。 */
function checkFax() {
  var lock = LockService.getScriptLock();
  // 前回の実行が終わっていなければ何もしない。同じ FAX を 2 回処理しないための要。
  if (!lock.tryLock(1000)) return;
  try {
    var label = getOrCreateLabel_(LABEL_DONE);
    var threads = GmailApp.search(SEARCH_QUERY, 0, MAX_THREADS_PER_RUN);
    for (var i = 0; i < threads.length; i++) {
      handleThread_(threads[i], label);
    }
    sweepGuards_();
  } finally {
    lock.releaseLock();
  }
}

function handleThread_(thread, label) {
  var messages = thread.getMessages();
  var allSent = true;
  for (var i = 0; i < messages.length; i++) {
    if (!handleMessage_(messages[i])) allSent = false;
  }
  // 1 通でも送れていなければラベルを付けない。次回の実行で拾い直す。
  if (allSent) thread.addLabel(label);
}

/** @return {boolean} 送信済みとみなしてよいか */
function handleMessage_(message) {
  var guard = GUARD_PREFIX + message.getId();
  var store = PropertiesService.getScriptProperties();
  if (store.getProperty(guard)) return true;  // 送信済み

  var pdf = firstPdf_(message.getAttachments());
  if (!pdf) return true;  // PDF が無いメールは対象外

  var fax = parseFaxHeader_(message.getPlainBody());
  var file = saveToDrive_(pdf, fax);

  var images = [];
  try {
    images = convertToImages_(pdf);
  } catch (err) {
    // 画像化に失敗しても通知自体は届けたい。本文と印刷ボタンだけ送る。
    console.warn('画像変換に失敗: ' + err);
  }

  // push する直前に印を付ける。送信途中で落ちても二重投稿にならない方を優先する。
  store.setProperty(guard, String(Date.now()));
  try {
    pushToLine_(buildMessages_(fax, file.getId(), images));
  } catch (err) {
    store.deleteProperty(guard);  // 送れていないので次回やり直す
    throw err;
  }
  return true;
}

function firstPdf_(attachments) {
  for (var i = 0; i < attachments.length; i++) {
    if (attachments[i].getContentType() === 'application/pdf') return attachments[i];
  }
  return null;
}

/** 複合機が本文に書く FROM=... 形式の行を拾う。 */
function parseFaxHeader_(body) {
  var fax = {};
  var keys = ['FROM', 'TO', 'DATE', 'TIME', 'TIMEZONE', 'FCODE', 'RJOBNUM'];
  for (var i = 0; i < keys.length; i++) {
    var hit = new RegExp(keys[i] + '=([^\\r\\n]*)').exec(body || '');
    fax[keys[i]] = hit ? hit[1].trim() : '';
  }
  return fax;
}

function saveToDrive_(pdf, fax) {
  var folder = DriveApp.getFolderById(prop_('DRIVE_FOLDER_ID'));
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  var suffix = fax.RJOBNUM ? '_' + fax.RJOBNUM : '';
  return folder.createFile(pdf.copyBlob().setName('FAX_' + stamp + suffix + '.pdf'));
}

function convertToImages_(pdf) {
  var response = UrlFetchApp.fetch(prop_('CONVERTER_URL'), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-API-Key': prop_('CONVERTER_API_KEY') },
    payload: JSON.stringify({ pdf_base64: Utilities.base64Encode(pdf.getBytes()) }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('変換関数が ' + response.getResponseCode() + ' を返しました: ' + response.getContentText());
  }
  return (JSON.parse(response.getContentText()).urls || []).slice(0, MAX_IMAGES);
}

/* -------------------------------------------------------------- LINE 送信 */

function buildMessages_(fax, fileId, images) {
  var messages = [faxFlex_(fax, fileId)];
  for (var i = 0; i < images.length; i++) {
    messages.push({ type: 'image', originalContentUrl: images[i], previewImageUrl: images[i] });
  }
  return messages;
}

function faxFlex_(fax, fileId) {
  var lines = ['FROM', 'TO', 'DATE', 'TIME', 'TIMEZONE', 'FCODE', 'RJOBNUM'].map(function (key) {
    return { type: 'text', text: key + '=' + fax[key], size: 'sm', weight: 'bold', wrap: true };
  });
  return {
    type: 'flex',
    altText: 'FAX受信 ' + (fax.FROM || ''),
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1E6FEB', paddingAll: 'lg',
        contents: [{ type: 'text', text: 'FAX受信', color: '#FFFFFF', size: 'xl', weight: 'bold' }],
      },
      body: {
        type: 'box', layout: 'horizontal', spacing: 'md',
        contents: [
          { type: 'text', text: '送信元', color: '#8C8C8C', size: 'sm', flex: 2 },
          { type: 'box', layout: 'vertical', flex: 5, contents: lines },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#1E6FEB',
          action: { type: 'postback', label: '印刷する', data: 'action=print&id=' + fileId },
        }],
      },
    },
  };
}

function pushToLine_(messages) {
  callLine_('https://api.line.me/v2/bot/message/push', {
    to: prop_('LINE_TARGET_ID'),
    messages: messages,
  });
}

function replyToLine_(replyToken, text) {
  callLine_('https://api.line.me/v2/bot/message/reply', {
    replyToken: replyToken,
    messages: [{ type: 'text', text: text }],
  });
}

function callLine_(url, payload) {
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('LINE API が ' + response.getResponseCode() + ' を返しました: ' + response.getContentText());
  }
}

/* ------------------------------------------------------- 印刷 (postback) */

/**
 * LINE webhook の受け口。ウェブアプリとして公開した URL を LINE に登録する。
 *
 * Apps Script の doPost は HTTP ヘッダを読めず、LINE の X-Line-Signature を
 * 検証できない。代わりに登録する URL の末尾に ?token=... を付け、その一致で
 * 正規の呼び出しか判定する (SETUP.md の「webhook の保護」参照)。
 */
function doPost(e) {
  if (!e || !e.postData || !e.parameter ||
      e.parameter.token !== prop_('WEBHOOK_TOKEN')) {
    return ContentService.createTextOutput('');
  }

  var events = (JSON.parse(e.postData.contents).events || []);
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (event.type !== 'postback') continue;
    // Apps Script は 302 を返すため、LINE 側で「Webhook の再送」が ON だと
    // 同じイベントが届き直す。再送分は捨てて印刷の二重実行を防ぐ。
    if (event.deliveryContext && event.deliveryContext.isRedelivery) continue;
    var params = parseQuery_(event.postback.data);
    if (params.action === 'print' && params.id) {
      handlePrint_(params.id, event.replyToken);
    }
  }
  return ContentService.createTextOutput('');
}

function handlePrint_(fileId, replyToken) {
  try {
    var file = DriveApp.getFileById(fileId);
    GmailApp.sendEmail(prop_('PRINTER_EMAIL'), 'FAX print', '', { attachments: [file.getBlob()] });
    replyToLine_(replyToken, '印刷ジョブを送信しました');
  } catch (err) {
    console.error('印刷に失敗: ' + err);
    replyToLine_(replyToken, '印刷に失敗しました: ' + err);
  }
}

function parseQuery_(data) {
  var out = {};
  (data || '').split('&').forEach(function (pair) {
    var kv = pair.split('=');
    if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  });
  return out;
}

/* ---------------------------------------------------------------- 後始末 */

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** 二重送信よけの印は 30 日で捨てる。プロパティの上限に当たらないように。 */
function sweepGuards_() {
  var store = PropertiesService.getScriptProperties();
  var all = store.getProperties();
  var limit = Date.now() - GUARD_TTL_MS;
  Object.keys(all).forEach(function (key) {
    if (key.indexOf(GUARD_PREFIX) === 0 && Number(all[key]) < limit) store.deleteProperty(key);
  });
}

/** 初回に 1 度だけ手で実行する。ラベルと 5 分間隔のトリガーを用意する。 */
function setup() {
  getOrCreateLabel_(LABEL_DONE);
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'checkFax') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('checkFax').timeBased().everyMinutes(5).create();
}
