// QA em produção: `QA_OUT=./qa-out node scripts/qa/telas.cjs`. Envs: QA_BASE, QA_EMAIL, QA_PASS[, QA_EMAIL2, QA_PASS2].
// Roda DENTRO do job (imagem playwright): login, screenshots em QA_OUT.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.env.QA_OUT || './qa-out';
const BASE = process.env.QA_BASE, EMAIL = process.env.QA_EMAIL, PASS = process.env.QA_PASS, PREFIX = process.env.QA_PREFIX || 'qa';
const up = async (name, buf) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name), buf); console.log('salvo', name); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await up('01-login.png', await page.screenshot());
  await page.fill('input[type=email], input[name=email]', EMAIL);
  await page.fill('input[type=password]', PASS);
  await page.click('button[type=submit]');
  await page.waitForTimeout(4000);
  await up('02-apos-login.png', await page.screenshot());
  console.log('url após login:', page.url());
  // Editor de avatar no primeiro login: tenta salvar
  const save = page.locator('button:has-text("Salvar"), button:has-text("Usar aleatório")');
  if (await save.count()) { await up('03-avatar-editor.png', await page.screenshot()); await save.last().click(); await page.waitForTimeout(3000); }
  await page.waitForTimeout(3000);
  await up('04-escritorio.png', await page.screenshot());
  try { await page.click('text=QA Bot', { timeout: 3000 }); await page.waitForTimeout(400); await page.click('text=Meu avatar', { timeout: 3000 }); await page.waitForTimeout(1500); await up('03b-meu-avatar.png', await page.screenshot()); await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch (e) { console.log('meu avatar:', e.message.split('\n')[0]); }
  await page.keyboard.press('['); await page.waitForTimeout(800); await up('05-chat.png', await page.screenshot()); await page.keyboard.press('[');
  await page.keyboard.press(']'); await page.waitForTimeout(800); await up('06-participantes.png', await page.screenshot()); await page.keyboard.press(']');
  await page.keyboard.press('?'); await page.waitForTimeout(500); await up('07-ajuda.png', await page.screenshot()); await page.keyboard.press('Escape');
  for (const k of ['d','d','d','s','s']) { await page.keyboard.down(k.toUpperCase()); await page.waitForTimeout(350); await page.keyboard.up(k.toUpperCase()); }
  await page.waitForTimeout(1000); await up('08-andou.png', await page.screenshot());
  // latência de rede realista (150 ms + jitter de banda) para reproduzir o "puxão de volta"
  try { const cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 2e6, uploadThroughput: 1e6 }); console.log('latencia 150ms ativa'); } catch (e) { console.log('sem cdp', e.message); }
  // fluidez: segura D por 2,5 s e amostra a posição do próprio avatar a cada quadro
  const fl = await page.evaluate(async () => {
    const w = window.escritorio; const av = () => { const r = w && w.world && w.world.minimapSource ? null : null; return r; };
    const store = w.store; const me = store.selfId; const ents = () => store.entities.get(me);
    const samples = []; let raf;
    const loop = (t) => { const rep = (w.world && w.world.__replica) || null; const a = rep ? rep.avatars.get(me) : null; samples.push({ t, x: a ? a.x : (ents() ? ents().x : 0), y: a ? a.y : (ents() ? ents().y : 0) }); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
    await new Promise((r) => setTimeout(r, 2500));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true }));
    await new Promise((r) => setTimeout(r, 2500));
    cancelAnimationFrame(raf);
    let back = 0, maxJump = 0, still = 0, moved = 0;
    for (let i = 1; i < samples.length; i++) { const dx = samples[i].x - samples[i - 1].x; const dy = samples[i].y - samples[i - 1].y; const d = Math.hypot(dx, dy); if (dx < -0.5) back++; if (d > maxJump) maxJump = d; if (d === 0) still++; else moved++; }
    let stopAt = -1; for (let i = samples.length - 1; i > 0; i--) { if (samples[i].x !== samples[i - 1].x) { stopAt = i; break; } }
    const dist = Math.hypot(samples[samples.length - 1].x - samples[0].x, samples[samples.length - 1].y - samples[0].y);
    const pred = w.world && w.world.__predictorStats ? w.world.__predictorStats() : null;
    return { frames: samples.length, dist, back, lastMoveFrame: stopAt, srvFinal: (() => { const e = store.entities.get(me); return e ? { x: e.x * 16, tx: Math.floor(e.x) } : null; })(), cliFinal: Math.round(samples[samples.length - 1].x), maxJump: +maxJump.toFixed(2), still, moved, pred };
  }).catch((e) => ({ erro: e.message }));
  console.log('FLUIDEZ', JSON.stringify(fl));
  await up('08b-fluidez.png', await page.screenshot());
  // senta numa baia (ilha A1) e fotografa de perto para conferir a ordem de desenho
  await page.evaluate(() => { const w = window.escritorio; w.__sent = []; const s = w.socket.send.bind(w.socket); w.socket.send = (m) => { w.__sent.push(m); return s(m); }; });
  const sat = await page.evaluate(() => { const w = window.escritorio; w.__recv = []; w.store.on('reject', (m) => w.__recv.push('reject:' + m.reason)); const a = w.world.minimapSource().assembly; const claimed = new Set([...w.store.desks.values()].filter((d) => d.userId !== null).map((d) => d.id)); const d = a.desks.find((x) => x.code.startsWith('A1') && !claimed.has(x.id)) || a.desks.find((x) => !claimed.has(x.id)) || a.desks[0]; return { code: d.code, claimedCount: claimed.size, ok: w.world.sitAt(d.spotId) }; }).catch((e) => ({ erro: e.message }));
  console.log('SENTAR', JSON.stringify(sat));
  await page.waitForTimeout(16000);
  await page.evaluate(() => { const w = window.escritorio; w.world.zoomBy && w.world.zoomBy(1.5); });
  await page.waitForTimeout(800);
  await up('08c-mesa.png', await page.screenshot());
  const after = await page.evaluate(() => { const w = window.escritorio; const me = w.store.selfId; const e = w.store.entities.get(me); const a = w.world.__replica.avatars.get(me); return { recv: w.__recv, sent: w.__sent.map((m) => m.t + (m.spot ? ':' + m.spot : '')).slice(-6), srv: e ? { x: e.x, y: e.y, seat: e.seat, pose: e.pose, moving: e.moving } : null, cli: a ? { x: Math.round(a.x), y: Math.round(a.y), seated: a.seated, pose: a.pose, spot: a.spot } : null, pred: w.world.__predictorStats() }; }).catch((e) => ({ erro: e.message }));
  console.log('APOS-SENTAR', JSON.stringify(after));
  // decoração: reivindica a mesa onde sentou, salva decoração e confere o estado + screenshot
  const deco = await page.evaluate(async () => {
    const w = window.escritorio; const me = w.store.selfId; const a = w.world.minimapSource().assembly;
    const e = w.store.entities.get(me); const spot = e && e.seat ? a.spotById.get(e.seat) : null; const desk = spot ? a.desks.find((d) => d.spotId === spot.id) : null;
    if (!desk) return { erro: 'sem mesa' };
    w.socket.send({ t: 'desk_claim', desk: desk.id });
    await new Promise((r) => setTimeout(r, 1500));
    const decor = { slots: { left: { kind: 'mug', variant: 'yellow' }, right: { kind: 'plant', variant: 'fern' }, back: { kind: 'lamp', variant: 'yellow' } } };
    const res = await fetch('/api/me/desk/decor', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decor }) });
    const body = await res.text();
    await new Promise((r) => setTimeout(r, 1500));
    const st = w.store.desks.get(desk.id);
    return { desk: desk.id, claimStatus: st ? st.userId : null, put: res.status, body: body.slice(0, 160), decor: st ? st.decor : null, replicaDesk: w.world.__replica.desks ? (w.world.__replica.desks.get ? w.world.__replica.desks.get(desk.id) : null) : 'sem-desks' };
  }).catch((e) => ({ erro: e.message }));
  console.log('DECOR', JSON.stringify(deco));
  await page.waitForTimeout(800);
  await up('08d-decor.png', await page.screenshot());
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await up('09-admin.png', await page.screenshot());
  await page.goto(BASE + '/admin/mapa', { waitUntil: 'networkidle' }); await page.waitForTimeout(3000); await up('10-admin-mapa.png', await page.screenshot());
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mob.newPage(); await mp.goto(BASE + '/login', { waitUntil: 'networkidle' }); await up('11-login-mobile.png', await mp.screenshot());
  await mp.fill('input[type=password]', PASS); await mp.fill('input[type=email], input[name=email]', EMAIL); await mp.click('button[type=submit]'); await mp.waitForTimeout(5000); await up('12-escritorio-mobile.png', await mp.screenshot());
  console.log('console:', logs.slice(0, 40).join('\n') || '(sem erros)');
  await browser.close();
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
