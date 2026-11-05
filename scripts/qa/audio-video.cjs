// QA em produção: `QA_OUT=./qa-out node scripts/qa/audio-video.cjs`. Envs: QA_BASE, QA_EMAIL, QA_PASS[, QA_EMAIL2, QA_PASS2].
// Dois usuários lado a lado em produção: verifica LiveKit (conexão, publicação, inscrição por proximidade) e tira screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.env.QA_OUT || './qa-out';
const BASE = process.env.QA_BASE, PREFIX = process.env.QA_PREFIX || 'qa-av';
const users = [[process.env.QA_EMAIL, process.env.QA_PASS], [process.env.QA_EMAIL2, process.env.QA_PASS2]];
const up = async (name, buf) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name), buf); console.log('salvo', name); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const pages = [];
  for (const [email, pass] of users) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, permissions: ['microphone', 'camera'] });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__pcs = []; window.__snaps = []; const O = window.RTCPeerConnection; const t0 = Date.now();
      const snap = async (pc, why) => { try { const st = await pc.getStats(); const cands = {}; const pairs = []; st.forEach((r) => { if (r.type === 'local-candidate' || r.type === 'remote-candidate') cands[r.id] = (r.type === 'local-candidate' ? 'L ' : 'R ') + r.protocol + ' ' + r.candidateType + ' ' + (r.address || r.ip || '?') + ':' + r.port + (r.tcpType ? ' ' + r.tcpType : ''); }); st.forEach((r) => { if (r.type === 'candidate-pair') pairs.push(r.state + ' ' + cands[r.localCandidateId] + ' <-> ' + cands[r.remoteCandidateId] + ' req=' + (r.requestsSent || 0) + ' resp=' + (r.responsesReceived || 0)); }); window.__snaps.push({ pc: pc.__id, why, t: Date.now() - t0, ice: pc.iceConnectionState, conn: pc.connectionState, sig: pc.signalingState, remoteSdp: !!pc.remoteDescription, cands: Object.values(cands), pairs }); } catch (e) { window.__snaps.push({ pc: pc.__id, why, erro: e.message }); } };
      window.RTCPeerConnection = function (...a) { const pc = new O(...a); pc.__id = window.__pcs.length; window.__pcs.push(pc); pc.__log = []; for (const ev of ['iceconnectionstatechange', 'connectionstatechange', 'signalingstatechange', 'icegatheringstatechange']) pc.addEventListener(ev, () => { pc.__log.push((Date.now() - t0) + 'ms ' + ev.replace('statechange', '') + '=' + (ev === 'iceconnectionstatechange' ? pc.iceConnectionState : ev === 'connectionstatechange' ? pc.connectionState : ev === 'signalingstatechange' ? pc.signalingState : pc.iceGatheringState)); if (ev === 'iceconnectionstatechange' && ['failed', 'disconnected', 'connected'].includes(pc.iceConnectionState)) snap(pc, 'ice=' + pc.iceConnectionState); });
        const close = pc.close.bind(pc); pc.close = () => { snap(pc, 'close').finally(() => close()); }; return pc; };
      window.RTCPeerConnection.prototype = O.prototype; Object.setPrototypeOf(window.RTCPeerConnection, O);
    });
    const logs = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
    page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('input[type=email], input[name=email]', email); await page.fill('input[type=password]', pass); await page.click('button[type=submit]');
    await page.waitForTimeout(4000);
    const save = page.locator('button:has-text("Usar aleatório"), button:has-text("Salvar e continuar")');
    if (await save.count()) { await save.first().click(); await page.waitForTimeout(3000); }
    await page.waitForTimeout(2000);
    pages.push({ page, logs, email });
  }
  // aproxima: ambos spawnaram na recepção; clica no mesmo tile (centro do canvas) e espera
  for (const { page } of pages) { await page.mouse.click(520, 380); await page.waitForTimeout(500); }
  await pages[1].page.mouse.click(540, 380);
  // espera até 75 s pela conexão de mídia (o fallback para ICE/TCP acontece depois que o UDP falha, ~15-30 s)
  const status = async (page) => page.evaluate(() => { const m = (window.escritorio || {}).media; return m && m.manager ? m.manager.status : null; }).catch(() => null);
  for (let i = 0; i < 25; i++) {
    const st = await Promise.all(pages.map(({ page }) => status(page)));
    console.log('status', i * 3 + 's', JSON.stringify(st));
    if (st.every((x) => x === 'connected')) break;
    await pages[0].page.waitForTimeout(3000);
  }
  // estatísticas ICE de cada PeerConnection (pares, candidatos locais/remotos)
  for (const [i, { page }] of pages.entries()) {
    const ice = await page.evaluate(async () => {
      const out = [];
      for (const pc of window.__pcs || []) {
        const st = await pc.getStats(); const cands = {}; const pairs = [];
        st.forEach((r) => { if (r.type === 'local-candidate' || r.type === 'remote-candidate') cands[r.id] = `${r.type === 'local-candidate' ? 'L' : 'R'} ${r.protocol} ${r.candidateType} ${r.address || r.ip || '?'}:${r.port}${r.tcpType ? ' ' + r.tcpType : ''}`; });
        st.forEach((r) => { if (r.type === 'candidate-pair') pairs.push(`${r.state} ${cands[r.localCandidateId]} <-> ${cands[r.remoteCandidateId]} req=${r.requestsSent || 0} resp=${r.responsesReceived || 0}`); });
        out.push({ ice: pc.iceConnectionState, conn: pc.connectionState, gathering: pc.iceGatheringState, local: Object.values(cands).filter((c) => c.startsWith('L')), remote: Object.values(cands).filter((c) => c.startsWith('R')), pairs });
      }
      return out;
    }).catch((e) => ({ erro: e.message }));
    console.log(`ICE user${i + 1}`, JSON.stringify(ice));
    const extra = await page.evaluate(() => ({ snaps: window.__snaps, logs: (window.__pcs || []).map((pc) => pc.__id + ': ' + pc.__log.join(', ')) })).catch((e) => ({ erro: e.message }));
    console.log(`SNAPS user${i + 1}`, JSON.stringify(extra));
  }
  for (const [i, { page }] of pages.entries()) {
    await page.mouse.move(10, 10);
    await up(`av-${i + 1}.png`, await page.screenshot());
    const info = await page.evaluate(() => {
      const e = window.escritorio || {};
      const st = e.store;
      const ents = st && st.entities ? [...st.entities.values()].map((x) => ({ id: x.id, x: Math.round(x.x), y: Math.round(x.y) })) : null;
      const av = st && st.avSet ? st.avSet : null;
      const media = st && st.media ? [...st.media.entries()] : null;
      const m = e.media;
      return { ents, av, media, mediaStatus: m && m.manager ? (m.manager.status || m.manager.state || null) : (m ? Object.keys(m) : null), tiles: document.querySelectorAll('#avbar .wd-tile').length, avbarText: (document.querySelector('#avbar') || {}).innerText };
    }).catch((e) => ({ erro: e.message }));
    console.log(`user${i + 1}`, JSON.stringify(info));
  }
  for (const { email, logs } of pages) console.log('console', email, logs.slice(0, 15).join(' | ') || '(sem erros)');
  await browser.close();
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
