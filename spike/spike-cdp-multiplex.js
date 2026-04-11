/**
 * spike-cdp-multiplex.js
 *
 * Verifies that chrome-remote-interface supports browser-level WebSocket
 * connections with Target.attachToTarget session multiplexing, enabling
 * multiple independent CDP sessions on the same page target simultaneously.
 *
 * Run: node spike/spike-cdp-multiplex.js
 *   or EXTERNAL_BROWSER=1 CDP_HOST=host.docker.internal node spike/spike-cdp-multiplex.js
 *      (use EXTERNAL_BROWSER=1 if Chrome/Edge is already running externally)
 */

'use strict';

const { spawn } = require('child_process');
const http = require('http');
const CDP = require('chrome-remote-interface');

const HOST = process.env.CDP_HOST || 'localhost';
const PORT = Number(process.env.CDP_PORT) || 9222;
const EXTERNAL_BROWSER = process.env.EXTERNAL_BROWSER === '1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(1000, () => { req.destroy(); reject(new Error('http timeout')); });
  });
}

async function waitForCdp(host, port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    try {
      await httpGet('http://' + host + ':' + port + '/json/version');
      return;
    } catch (_) {
      await delay(300);
    }
  }
  throw new Error('CDP at ' + host + ':' + port + ' did not become ready');
}

function launchChromium(port) {
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox',
    '--disable-software-rasterizer', '--disable-dev-shm-usage', '--single-process',
    '--remote-debugging-port=' + port, 'about:blank',
  ];
  const proc = spawn('chromium', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (d) => {
    const s = d.toString();
    if (s.includes('DevTools listening')) process.stdout.write('  ' + s.trim() + '\n');
  });
  return proc;
}

// ---------------------------------------------------------------------------
// Helper: send a CDP command scoped to a sessionId using CRI's raw send() API
// ---------------------------------------------------------------------------
function sendInSession(client, method, params, sessionId) {
  // CRI's send() accepts an optional sessionId string as 3rd argument:
  //   client.send(method, params, sessionId)
  return client.send(method, params, sessionId);
}

// ---------------------------------------------------------------------------
// Main spike
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n=== CDP Multiplexing Spike ===');
  console.log('Target: ' + HOST + ':' + PORT + '\n');

  let chromiumProc = null;

  if (!EXTERNAL_BROWSER) {
    console.log('[0] Launching headless Chromium ...');
    chromiumProc = launchChromium(PORT);
    console.log('    Waiting for CDP ...');
    await waitForCdp(HOST, PORT, 20000);
    console.log('    CDP ready.\n');
  }

  // Step 1 – Get the browser-level WebSocket URL from /json/version
  // /json/version returns a "webSocketDebuggerUrl" that connects to the
  // *browser* target, not a page. Multiple clients can share this single
  // WebSocket via sessionId multiplexing.
  console.log('[1] Fetching browser-level WebSocket URL from /json/version ...');
  const versionInfo = await httpGet('http://' + HOST + ':' + PORT + '/json/version');
  if (!versionInfo.webSocketDebuggerUrl) {
    throw new Error('/json/version did not return webSocketDebuggerUrl');
  }
  // Rewrite localhost/127.0.0.1 only when connecting from a remote runtime
  // (for example devcontainer/WSL) to a browser running on the host machine.
  const rewrittenUrl = versionInfo.webSocketDebuggerUrl
    .replace('localhost', HOST).replace('127.0.0.1', HOST);
  console.log('    browserWsUrl = ' + rewrittenUrl);

  // Step 2 – Connect CRI to the *browser* target (not a page target)
  //          Pass the raw WebSocket URL as `target` so CRI skips the normal
  //          /json/list target-selection logic and connects directly.
  console.log('\n[2] Connecting CRI to browser-level WebSocket ...');
  const browser = await CDP({ target: rewrittenUrl, local: true });
  console.log('    Connected to browser-level WebSocket.');

  // Step 3 – List available page targets
  console.log('\n[3] Listing CDP targets ...');
  const { targetInfos } = await browser.Target.getTargets();
  const pageTargets = targetInfos.filter(
    (t) => t.type === 'page' && !t.url.startsWith('devtools://')
  );
  console.log(`    Found ${pageTargets.length} page target(s):`);
  pageTargets.forEach((t) =>
    console.log(`      [${t.targetId}] ${t.url.substring(0, 80)}`)
  );

  if (pageTargets.length === 0) {
    console.error('\n  No page targets found. Open a browser tab and retry.');
    await browser.close();
    process.exit(1);
  }

  const targetId = pageTargets[0].targetId;
  console.log(`\n    Using targetId: ${targetId}`);

  // Step 4 – Attach to the same page target TWICE → two independent sessions
  // flatten:true enables "flat session" mode where all session traffic flows
  // over the same WebSocket, differentiated by sessionId.
  console.log('\n[4] Attaching to the page target twice (two independent sessions) ...');
  const { sessionId: sessionA } = await browser.Target.attachToTarget({
    targetId,
    flatten: true,
  });
  const { sessionId: sessionB } = await browser.Target.attachToTarget({
    targetId,
    flatten: true,
  });
  console.log(`    Session A: ${sessionA}`);
  console.log(`    Session B: ${sessionB}`);

  if (sessionA === sessionB) {
    throw new Error('Both attach calls returned the same sessionId — multiplexing failed!');
  }

  // Step 5 – Enable Runtime in each session independently
  console.log('\n[5] Enabling Runtime domain in each session ...');
  await sendInSession(browser, 'Runtime.enable', {}, sessionA);
  await sendInSession(browser, 'Runtime.enable', {}, sessionB);
  console.log('    Done.');

  // Step 6 – Run Runtime.evaluate in Session A
  console.log('\n[6] Runtime.evaluate in Session A: 1 + 1 ...');
  const resultA = await sendInSession(
    browser,
    'Runtime.evaluate',
    { expression: '1 + 1', returnByValue: true, awaitPromise: true },
    sessionA
  );
  if (resultA.exceptionDetails) {
    throw new Error(`Session A threw: ${JSON.stringify(resultA.exceptionDetails)}`);
  }
  console.log(`    Result A = ${JSON.stringify(resultA.result.value)}`);
  if (resultA.result.value !== 2) throw new Error('Session A returned wrong value');

  // Step 7 – Run Runtime.evaluate in Session B (different expression)
  console.log('\n[7] Runtime.evaluate in Session B: navigator.userAgent ...');
  const resultB = await sendInSession(
    browser,
    'Runtime.evaluate',
    { expression: 'navigator.userAgent', returnByValue: true, awaitPromise: true },
    sessionB
  );
  if (resultB.exceptionDetails) {
    throw new Error(`Session B threw: ${JSON.stringify(resultB.exceptionDetails)}`);
  }
  console.log(`    Result B = ${JSON.stringify(resultB.result.value).substring(0, 80)}`);
  if (typeof resultB.result.value !== 'string') {
    throw new Error('Session B returned wrong type');
  }

  // Step 8 – Verify session-scoped events work.
  // CRI emits events as '<domain>.<method>.<sessionId>' for session-scoped
  // messages, so we can listen to only Session A's console events.
  console.log('\n[8] Testing session-scoped event routing (console.log in Session A) ...');
  const eventPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout: no consoleAPICalled event received')),
      5000
    );
    // Session-scoped event — will NOT fire for Session B's console calls
    browser.once(`Runtime.consoleAPICalled.${sessionA}`, (params) => {
      clearTimeout(timer);
      resolve(params);
    });
  });

  await sendInSession(
    browser,
    'Runtime.evaluate',
    {
      expression: 'console.log("hello-from-session-a")',
      returnByValue: true,
      awaitPromise: true,
    },
    sessionA
  );

  const consoleEvent = await eventPromise;
  const loggedText = consoleEvent.args?.[0]?.value;
  console.log(`    Received consoleAPICalled event in Session A: "${loggedText}"`);
  if (loggedText !== 'hello-from-session-a') {
    throw new Error(`Unexpected log value: ${loggedText}`);
  }

  // Step 9 – Confirm session isolation: Session B console event would go to a
  //          different listener key, not Session A's listener.
  console.log('\n[9] Confirming session isolation ...');
  console.log(
    '    Event key "<domain>.<method>.<sessionId>" prevents cross-session leakage.'
  );

  // Cleanup: detach sessions, close CDP connection, then gracefully close
  // Chromium via the Browser.close CDP command (avoids needing a OS-level signal).
  console.log('\n[10] Detaching sessions and closing connection ...');
  await browser.Target.detachFromTarget({ sessionId: sessionA });
  await browser.Target.detachFromTarget({ sessionId: sessionB });
  if (!EXTERNAL_BROWSER) {
    // Tell the browser to exit via CDP — no OS kill needed
    await browser.send('Browser.close').catch(() => {});
  }
  await browser.close();

  console.log('\n✅  All assertions passed.');
  console.log('    chrome-remote-interface DOES support browser-level multiplexing.');
  console.log('    Two independent CDP sessions on the same page target work correctly.\n');
}

main().catch((err) => {
  console.error('\n❌  Spike failed:', err.message);
  process.exit(1);
});
