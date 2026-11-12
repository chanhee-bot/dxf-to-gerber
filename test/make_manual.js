// 사용설명서 만들기: 화면 사진(docs/img/) → docs/manual.html → docs/DXF_to_Gerber_Manual.pdf
//   node test/make_manual.js          화면 사진을 다시 찍고 PDF를 만든다
//   node test/make_manual.js --pdf    화면 사진은 그대로 두고 PDF만 다시 만든다
// 프로그램(DXF_to_Gerber.html)은 고치지 않는다. 표시(번호·테두리)는 찍을 때만 화면 위에 덧그린다.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const root = path.join(__dirname, '..'), docs = path.join(root, 'docs'), img = path.join(docs, 'img');
const url = f => 'file:///' + f.replace(/\\/g, '/').replace(/^\//, '');
fs.mkdirSync(img, { recursive: true });

async function shots(browser) {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url(path.join(root, 'DXF_to_Gerber.html')));
  const wait = ms => page.waitForTimeout(ms);
  const done = () => page.waitForFunction(() => window.__app.S.result && !window.__app.S.busy, null, { timeout: 120000 });
  // 표시: {sel | rect:[x,y,w,h], n, pad, at:'tl'|'tr'|'bl'|'br'|'l', box:false}
  const mark = list => page.evaluate(list => {
    let host = document.getElementById('__marks'); if (host) host.remove();
    host = document.createElement('div'); host.id = '__marks'; host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
    for (const m of list) {
      let r;
      if (m.sel) { const e = document.querySelector(m.sel); if (!e) continue; const b = e.getBoundingClientRect(); r = [b.left, b.top, b.width, b.height]; } else r = m.rect;
      const p = m.pad == null ? 3 : m.pad; r = [r[0] - p, r[1] - p, r[2] + 2 * p, r[3] + 2 * p];
      if (m.box !== false) { const d = document.createElement('div'); d.style.cssText = 'position:absolute;border:2.5px solid #ff2d2d;border-radius:5px;left:' + r[0] + 'px;top:' + r[1] + 'px;width:' + r[2] + 'px;height:' + r[3] + 'px'; host.appendChild(d); }
      if (m.n != null) {
        const at = m.at || 'tl', s = 24, x = at === 'l' ? r[0] - s - 3 : at[1] === 'l' ? r[0] - s / 2 : r[0] + r[2] - s / 2, y = at === 'l' ? r[1] + r[3] / 2 - s / 2 : at[0] === 't' ? r[1] - s / 2 : r[1] + r[3] - s / 2;
        const b = document.createElement('div'); b.textContent = m.n;
        b.style.cssText = 'position:absolute;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:#ff2d2d;color:#fff;font:700 14px/' + s + 'px Arial,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff;left:' + Math.max(1, x) + 'px;top:' + Math.max(1, y) + 'px';
        host.appendChild(b);
      }
    }
    document.body.appendChild(host);
  }, list);
  const unmark = () => page.evaluate(() => { const h = document.getElementById('__marks'); if (h) h.remove(); });
  const box = async (sel, pad) => { const b = await page.locator(sel).first().boundingBox(); const p = pad == null ? 8 : pad; return { x: Math.max(0, b.x - p), y: Math.max(0, b.y - p), width: b.width + 2 * p, height: b.height + 2 * p }; };
  const union = async (sels, pad) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const s of sels) { const b = await page.locator(s).first().boundingBox(); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); } const p = pad == null ? 8 : pad; return { x: Math.max(0, x0 - p), y: Math.max(0, y0 - p), width: x1 - x0 + 2 * p, height: y1 - y0 + 2 * p }; };
  const snap = async (name, clip) => { await wait(250); await page.screenshot({ path: path.join(img, name + '.png'), clip: clip || undefined }); console.log('  ' + name + '.png'); };
  const toScreen = (x, y) => page.evaluate(([x, y]) => { const V = window.__app.V, c = document.getElementById('cv'), r = c.getBoundingClientRect(); return [r.left + (c.width / 2 + (x - V.cx) * V.scale) / V.dpr, r.top + (c.height / 2 - (y - V.cy) * V.scale) / V.dpr]; }, [x, y]);
  const zoom = async bb => { await page.evaluate(bb => { const V = window.__app.V, c = document.getElementById('cv'); V.cx = (bb[0] + bb[2]) / 2; V.cy = (bb[1] + bb[3]) / 2; V.scale = Math.min(c.width / (bb[2] - bb[0]), c.height / (bb[3] - bb[1])) * 0.9; document.getElementById('vOrig').dispatchEvent(new Event('change')); }, bb); await wait(350); };
  const wrect = async (bb, n, at) => { const a = await toScreen(bb[0], bb[3]), b = await toScreen(bb[2], bb[1]); return { rect: [a[0], a[1], b[0] - a[0], b[1] - a[1]], n, at, pad: 0 }; };
  // 세계 좌표 범위에 맞춰 확대하고 그 범위(+ 창 pop)만 잘라 찍는다
  const wclip = async (bb, withPop) => { const a = await toScreen(bb[0], bb[3]), b = await toScreen(bb[2], bb[1]), c = await page.locator('#cvWrap').boundingBox(); let x0 = a[0], y0 = a[1], x1 = b[0], y1 = b[1]; if (withPop) { const q = await page.locator('#pop').boundingBox(); if (q) { x0 = Math.min(x0, q.x - 16); y0 = Math.min(y0, q.y - 16); x1 = Math.max(x1, q.x + q.width + 16); y1 = Math.max(y1, q.y + q.height + 16); } } x0 = Math.max(c.x, x0); y0 = Math.max(c.y, y0); x1 = Math.min(c.x + c.width, x1); y1 = Math.min(c.y + c.height, y1); return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }; };
  const snapW = async (name, bb, withPop) => snap(name, await wclip(bb, withPop));
  const showOnly = async on => { for (const t of ['cu1', 'cu2', 'mask', 'mask2', 'outline']) { const id = '#show_' + t; if (await page.$(id)) { if (on.includes(t)) await page.check(id); else await page.uncheck(id); } } await wait(150); };
  const ALL = ['cu1', 'cu2', 'mask', 'mask2', 'outline'];
  const scrollTo = sel => page.evaluate(sel => document.querySelector(sel).scrollIntoView({ block: 'center' }), sel);
  const CARD = n => '#left .card:nth-of-type(' + n + ')';
  const RCARD = n => '#right .card:nth-of-type(' + n + ')';

  // 1. 처음 화면
  await mark([{ sel: '#left', n: 1, pad: -3, at: 'tl' }, { sel: '#center', n: 2, pad: -3, at: 'tl' }, { sel: '#right', n: 3, pad: -3, at: 'tl' }, { sel: '#build', n: 4, at: 'br' }]);
  await snap('01_start'); await unmark();

  // 2. 예제 도면을 연 직후(아직 변환 전)
  await page.click('#btnExample'); await wait(500);
  await mark([{ sel: '#drop', n: 1, at: 'tr' }, { sel: '#fileMsg', n: 2, at: 'tr' }]);
  await snap('03_file_card', await box(CARD(1), 14)); await unmark();
  { const c = await box('header', 0); c.x = c.width - 620; c.width = 620; await snap('02_fileinfo', c); }
  await snap('04_options', await box(CARD(2)));
  await scrollTo(CARD(3));
  await mark([{ sel: '#layerTbl', n: 1 }, { sel: '#btnConvert', n: 2, at: 'bl' }, { sel: '#applyMsg', n: 3, at: 'tr' }]);
  await snap('05_layers', await union([CARD(3), '#applyCard'])); await unmark();
  await page.evaluate(() => document.getElementById('left').scrollTop = 0);
  await scrollTo('#applyCard'); await mark([{ sel: '#dirtyBar', n: 1, at: 'tr' }, { sel: '#btnConvert', n: 1, at: 'tr' }]);
  await snap('06_before_convert'); await unmark();

  // 3. 변환
  await page.click('#btnConvert'); await done(); await wait(400);
  await page.evaluate(() => document.getElementById('left').scrollTop = 0);
  await mark([{ sel: '#toolbar', n: 1, pad: -2, at: 'bl' }, { sel: '#cvWrap', n: 2, pad: -3, at: 'tl' }, { sel: '#legend', n: 3, pad: -2, at: 'tl' }, { sel: RCARD(1), n: 4, at: 'tl' }, { sel: RCARD(2), n: 5, at: 'tl' }]);
  await snap('07_converted'); await unmark();
  await scrollTo('#applyCard');
  await snap('08_apply_done', await box('#applyCard'));
  await page.evaluate(() => document.getElementById('left').scrollTop = 1e5);
  await mark([{ sel: '#oFormat', n: 1, at: 'l' }, { sel: '#file_cu1', n: 2, at: 'tl' }, { sel: '#mir_cu1', n: 3, at: 'tl', pad: 6 }, { sel: '#dl_cu1', n: 4, at: 'tr' }, { sel: '#btnZip', n: 5, at: 'bl' }]);
  await snap('09_output_gerber', await box(CARD(5))); await unmark();
  await snap('10_toolbar', await box('#toolbar', 0));
  await snap('11_legend', await box('#legend', 0));
  await snap('12_summary', await box(RCARD(1)));
  await page.evaluate(() => { document.querySelectorAll('#warnBox .list').forEach(l => l.style.maxHeight = '74px'); });
  await snap('13_warnings', await box(RCARD(2)));
  await page.evaluate(() => { document.querySelectorAll('#warnBox .list').forEach(l => l.style.maxHeight = ''); });

  // 4. 미리보기 확대
  const cvClip = () => box('#cvWrap', 0);
  await showOnly(['cu1', 'outline']);
  let bb = [1, 4.8, 23, 18.6];
  await zoom(bb);
  await mark([await wrect([1.3, 5.3, 8.8, 11.2], 1), await wrect([13.3, 5.3, 22.7, 8.7], 2), await wrect([1.3, 13.2, 12.7, 18.2], 3), await wrect([13.3, 13.3, 20.4, 14.7], 4, 'bl'), await wrect([13.3, 16.3, 21.7, 17.7], 5)]);
  await snapW('14_traces', bb); await unmark();
  bb = [7.45, 5.55, 8.55, 6.45]; await zoom(bb); await snapW('15_corner', bb);
  bb = [6.2, 13.5, 7.8, 14.7]; await zoom(bb); await snapW('16_tee', bb);
  bb = [1, 23, 25, 25]; await zoom(bb); await snapW('17_pads', bb);
  bb = [13.3, 13.3, 20.5, 14.7]; await zoom(bb); await snapW('18_step_end', bb);
  bb = [13.3, 16.3, 21.7, 17.7]; await zoom(bb); await snapW('18_taper', bb);
  bb = [23.5, 13.5, 25.7, 15.9]; await zoom(bb); await snapW('19_padcut', bb);
  bb = [1.5, 32.7, 10.5, 34.5]; await zoom(bb); await snapW('20_text', bb);
  bb = [7, 30.3, 12.5, 31.7]; await zoom(bb); await snapW('21_narrow', bb);
  bb = [1.2, 30.2, 4.2, 31.8]; await zoom(bb); await snapW('21_stub', bb);

  // 5. 클릭해서 바꾸기
  bb = [0.5, -1.4, 13.5, 3.4]; await zoom(bb);
  let p = await toScreen(2, 2);
  await page.mouse.click(p[0], p[1]); await page.waitForSelector('#pop button[data-role=trace]');
  await mark([{ sel: '#pop', n: 1, at: 'tr' }, { sel: '#popRoles', n: 2, at: 'l' }]);
  await snapW('22_popup', bb, true); await unmark();
  await page.click('#pop button[data-role=trace]'); await done(); await wait(300);
  await snapW('23_popup_changed', bb, true);
  await page.evaluate(() => document.getElementById('right').scrollTop = 1e5);
  await snap('24_overrides', await box(RCARD(4)));
  await page.click('#ovBox button'); await done(); await wait(200);
  await page.evaluate(() => document.getElementById('right').scrollTop = 0);
  await page.keyboard.press('Escape');
  // 여러 개 선택
  let a = await toScreen(2, 2), b = await toScreen(12, 2);
  await page.mouse.click(a[0], a[1]);
  await page.keyboard.down('Control'); await page.mouse.click(b[0], b[1]); await page.keyboard.up('Control');
  await snapW('25_multi', bb, true);
  await page.keyboard.press('Escape');
  await page.check('#vBox');
  let p0 = await toScreen(1, 0.8), p1 = await toScreen(13, 3.2);
  await page.mouse.move(p0[0], p0[1]); await page.mouse.down(); await page.mouse.move(p1[0] - 60, p1[1] + 20, { steps: 4 });
  await snapW('26_box', bb);
  await page.mouse.move(p1[0], p1[1]); await page.mouse.up(); await wait(200);
  await page.keyboard.press('Escape'); await page.uncheck('#vBox');

  // 6. 안쪽 폴리선: 지정 전 → 빈 곳
  bb = [15.3, 29.4, 22.7, 34.6]; await zoom(bb);
  await snapW('27_nested_before', bb);
  await page.click('#warnBox .item[data-wtype=nested]'); await page.waitForSelector('#pop button[data-void=true]');
  await zoom(bb); await wait(1700);
  await mark([{ sel: '#popVoid', n: 1, at: 'l' }]);
  await snapW('28_nested_pop', bb, true); await unmark();
  await page.click('#pop button[data-void=true]'); await done(); await wait(300);
  await page.keyboard.press('Escape'); await zoom(bb);
  await snapW('29_nested_void', bb);
  await page.evaluate(() => { const S = window.__app.S; for (const k in S.voids) delete S.voids[k]; });
  // 번갈아 옵션
  await page.check('#oAllVoid'); await wait(200);
  await page.click('#btnConvert'); await done(); await wait(300);
  bb = [23.7, 4.2, 27.3, 7.8]; await zoom(bb); await snapW('30_alternate', bb);
  await page.uncheck('#oAllVoid'); await page.click('#btnConvert'); await done(); await wait(300);

  // 7. 마스크 선으로 보기 켬/끔, 레이어별 색
  await showOnly(ALL);
  bb = [0.8, 23, 15, 25]; await zoom(bb);
  await snapW('31_mask_line', bb);
  await page.uncheck('#vMaskLine'); await wait(200);
  await snapW('32_mask_face', bb);
  await page.check('#vMaskLine');
  await page.selectOption('#vColor', 'layer'); await page.click('#btnFit'); await wait(300);
  { const c = await box('#legend', 0); c.width = 640; await snap('33_layer_color', c); }
  await page.selectOption('#vColor', 'kind'); await wait(200);

  // 8. 설정을 바꾼 뒤(변환 대기)
  await page.fill('#oOutW', '0.2'); await page.dispatchEvent('#oOutW', 'change'); await wait(300);
  await scrollTo('#applyCard');
  await mark([{ sel: '#dirtyBar', n: 1, at: 'tr' }, { sel: '#applyCard', n: 2, at: 'tr' }]);
  await snap('34_dirty'); await unmark();
  await page.click('#btnConvert'); await done(); await wait(300);
  await snap('35_apply_partial', await box('#applyCard'));
  await page.fill('#oOutW', '0.1'); await page.dispatchEvent('#oOutW', 'change'); await page.click('#btnConvert'); await done();

  // 9. 오른쪽 아래 목록
  await page.evaluate(() => document.getElementById('right').scrollTop = 1e5); await wait(200);
  await page.evaluate(() => { document.querySelectorAll('#apBox details').forEach((d, i) => { d.open = i === 0; }); document.querySelector('#right .card:nth-of-type(3)').scrollIntoView({ block: 'start' }); }); await wait(200);
  { const c = await box(RCARD(3)); c.height = Math.min(c.height, 330); await snap('36_apertures', c); }
  await page.evaluate(() => document.getElementById('right').scrollTop = 1e5); await wait(200);
  await snap('37_ignored', await box(RCARD(5)));
  await page.evaluate(() => document.getElementById('right').scrollTop = 0);

  // 10. ODB++
  await page.selectOption('#oFormat', 'odb'); await wait(300);
  await page.click('#btnConvert'); await done(); await wait(300);
  await page.selectOption('#oOdbUnit', 'mm');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnOdbTgz')]);
  await dl.path(); await wait(500);
  await page.evaluate(() => document.getElementById('left').scrollTop = 1e5); await wait(200);
  await mark([{ sel: '#oFormat', n: 1, at: 'l' }, { sel: '#oOdbUnit', n: 2, at: 'l' }, { sel: '#oOdbStep', n: 3, at: 'tr', pad: 6 }, { sel: '#btnOdbTgz', n: 4, at: 'bl' }, { sel: '#odbMsg', n: 5, at: 'tr' }]);
  await snap('38_output_odb', await box(CARD(5))); await unmark();
  const odbText = await page.evaluate(() => document.getElementById('odbMsg').innerText);
  fs.writeFileSync(path.join(__dirname, 'out', 'manual_odb_msg.txt'), odbText);

  if (errors.length) console.log('페이지 오류:', errors);
  await page.close();
}

// PDF에서 쪽 번호 찾기: Chromium이 넣는 책갈피(/Outlines)의 제목 순서 → 쪽
function outlinePages(buf) {
  const s = buf.toString('latin1'), objs = new Map(); let m;
  const re = /(\d+) 0 obj\s*([\s\S]*?)\s*endobj/g;
  while ((m = re.exec(s))) objs.set(+m[1], m[2]);
  const pages = []; // 쪽 객체 번호를 문서 순서대로
  const walk = id => { const o = objs.get(id); if (!o) return; if (/\/Type\s*\/Pages\b/.test(o)) { const k = /\/Kids\s*\[([^\]]*)\]/.exec(o); if (k) for (const q of k[1].matchAll(/(\d+) 0 R/g)) walk(+q[1]); } else if (/\/Type\s*\/Page\b/.test(o)) pages.push(id); };
  for (const [id, o] of objs) if (/\/Type\s*\/Catalog\b/.test(o)) { const p = /\/Pages\s+(\d+) 0 R/.exec(o); if (p) walk(+p[1]); }
  // 책갈피는 문서 순서대로: /First → (자식) → /Next
  const out = [], ref = (o, k) => { const q = new RegExp('/' + k + '\\s+(\\d+) 0 R').exec(o); return q ? +q[1] : 0; };
  const go = id => { for (let n = 0; id && n < 5000; n++) { const o = objs.get(id); if (!o) break; const d = /\/Dest\s*\[\s*(\d+) 0 R/.exec(o); if (d) out.push({ page: pages.indexOf(+d[1]) + 1 }); const f = ref(o, 'First'); if (f) go(f); id = ref(o, 'Next'); } };
  for (const [, o] of objs) if (/\/Type\s*\/Catalog\b/.test(o)) { const r = ref(o, 'Outlines'); if (r) go(ref(objs.get(r) || '', 'First')); }
  return { pages: pages.length, dests: out };
}

async function pdf(browser) {
  const html = fs.readFileSync(path.join(root, 'DXF_to_Gerber.html'), 'utf8');
  const build = (/const BUILD = '([^']+)'/.exec(html) || [])[1] || '?';
  const page = await browser.newPage();
  await page.goto(url(path.join(docs, 'manual.html')));
  await page.evaluate(b => window.setManual && window.setManual({ build: b }), build);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  const broken = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')));
  if (broken.length) console.log('없는 그림:', broken);
  const out = path.join(docs, 'DXF_to_Gerber_Manual.pdf');
  const opt = { path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, outline: true, tagged: true };
  // 1차: 쪽 번호 없는 목차로 찍어 제목마다 몇 쪽인지 알아낸다 → 2차: 목차에 쪽 번호를 넣어 다시 찍는다
  let buf = await page.pdf(opt);
  const heads = await page.evaluate(() => [...document.querySelectorAll('h1[id],h2[id],h3[id]')].map(h => h.id));
  let info = outlinePages(buf);
  if (info.dests.length === heads.length) {
    const map = {}; heads.forEach((id, i) => { map[id] = info.dests[i].page; });
    await page.evaluate(map => window.setManual({ pages: map }), map);
    buf = await page.pdf(opt); const again = outlinePages(buf);
    const moved = heads.filter((id, i) => again.dests[i].page !== map[id]);
    if (moved.length) console.log('주의: 목차를 넣은 뒤 쪽이 바뀐 제목', moved);
    info = again;
  } else console.log('주의: 책갈피 ' + info.dests.length + '개 ≠ 제목 ' + heads.length + '개 — 목차 쪽 번호를 넣지 못함');
  console.log('PDF: ' + path.relative(root, out) + ' · ' + info.pages + '쪽 · ' + (buf.length / 1e6).toFixed(2) + 'MB · 빌드 ' + build);
  await page.close();
}

(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const browser = await chromium.launch();
  if (!process.argv.includes('--pdf')) { console.log('화면 사진:'); await shots(browser); }
  if (fs.existsSync(path.join(docs, 'manual.html'))) await pdf(browser); else console.log('docs/manual.html 이 없어 PDF는 만들지 않음');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
