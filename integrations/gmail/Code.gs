/**
 * Gmail -> Support Inbox connector (Google Apps Script).
 *
 * Forwards emails that carry the Gmail label "support" to the app's webhook.
 * Nothing else in the mailbox is read or forwarded. Setup steps: "Gmail connector" in the root README.md.
 *
 * Script properties (Project Settings -> Script properties), never hardcoded:
 *   WEBHOOK_URL     e.g. https://203-0-113-10.sslip.io/api/webhook/email
 *   WEBHOOK_SECRET  same value as WEBHOOK_SECRET in the server's .env
 *   SUPPORT_LABEL   optional, defaults to "support"
 */

var DEFAULT_LABEL = 'support';
// Re-check a few minutes back each run so late-indexed mail isn't missed; the server ignores duplicates.
var OVERLAP_SECONDS = 5 * 60;
// On the very first run, look back this far.
var FIRST_RUN_LOOKBACK_SECONDS = 24 * 60 * 60;
var MAX_THREADS_PER_RUN = 50;

/** Runs on the time trigger. */
function forwardSupportEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // previous run still going

  try {
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty('WEBHOOK_URL');
    var secret = props.getProperty('WEBHOOK_SECRET');
    var label = props.getProperty('SUPPORT_LABEL') || DEFAULT_LABEL;
    if (!url || !secret) throw new Error('Set WEBHOOK_URL and WEBHOOK_SECRET in Script properties.');

    var nowSec = Math.floor(Date.now() / 1000);
    var cursor = Number(props.getProperty('CURSOR') || nowSec - FIRST_RUN_LOOKBACK_SECONDS);
    var since = cursor - OVERLAP_SECONDS;
    var me = Session.getEffectiveUser().getEmail().toLowerCase();

    // Gmail search: only the support label, only recent mail.
    var query = 'label:' + quoteLabel(label) + ' after:' + since;
    var threads = GmailApp.search(query, 0, MAX_THREADS_PER_RUN);

    var nextCursor = nowSec;
    var sent = 0;
    var failed = 0;

    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (msg) {
        var msgSec = Math.floor(msg.getDate().getTime() / 1000);
        if (msgSec < since) return;

        var from = parseAddress(msg.getFrom());
        if (from.email === me) return; // our own replies in the thread

        var ok = postEmail(url, secret, msg, from);
        if (ok) {
          sent++;
        } else {
          failed++;
          // Don't move the cursor past a message that failed, so it is retried next run.
          nextCursor = Math.min(nextCursor, msgSec);
        }
      });
    });

    props.setProperty('CURSOR', String(nextCursor));
    if (sent || failed) console.log('Forwarded ' + sent + ', failed ' + failed);
  } finally {
    lock.releaseLock();
  }
}

function postEmail(url, secret, msg, from) {
  var payload = {
    messageId: msg.getHeader('Message-ID') || msg.getId(),
    from: from.email,
    fromName: from.name || undefined,
    subject: msg.getSubject() || '',
    body: msg.getPlainBody() || '',
    headers: {
      autoSubmitted: msg.getHeader('Auto-Submitted') || undefined,
      precedence: msg.getHeader('Precedence') || undefined,
    },
  };

  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Webhook-Secret': secret },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: false,
    });
    var code = res.getResponseCode();
    // 202 = new ticket, 200 = duplicate (already have it). Both count as delivered.
    if (code === 200 || code === 202) return true;
    // 400 means the email itself is invalid (e.g. unparseable sender); retrying won't help.
    if (code === 400) {
      console.warn('Rejected by server (400), skipping: ' + payload.messageId);
      return true;
    }
    console.error('Webhook returned ' + code + ' for ' + payload.messageId);
    return false;
  } catch (e) {
    console.error('Webhook call failed: ' + e);
    return false;
  }
}

/** "Jane Doe <jane@example.com>" -> { name: "Jane Doe", email: "jane@example.com" } */
function parseAddress(raw) {
  var m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw || '');
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: String(raw || '').trim().toLowerCase() };
}

function quoteLabel(label) {
  // Gmail search uses hyphens for spaces and slashes in label names.
  return label.replace(/[\s/]+/g, '-');
}

/** Run once by hand: installs the every-minute trigger (removes old ones first). */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'forwardSupportEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('forwardSupportEmails').timeBased().everyMinutes(1).create();
  console.log('Trigger installed: forwardSupportEmails every minute');
}

/** Run by hand to stop forwarding. */
function uninstallTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'forwardSupportEmails') ScriptApp.deleteTrigger(t);
  });
  console.log('Trigger removed');
}

/** Run by hand to re-forward everything from the last N hours (server dedupes). */
function resetCursor() {
  PropertiesService.getScriptProperties().setProperty(
    'CURSOR',
    String(Math.floor(Date.now() / 1000) - FIRST_RUN_LOOKBACK_SECONDS),
  );
  console.log('Cursor reset to 24h ago');
}
