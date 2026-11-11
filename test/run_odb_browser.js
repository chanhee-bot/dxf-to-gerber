// ODB++ 빌드의 브라우저 동작 확인: 예제 도면 → ODB++ .tgz/.zip 내려받기 → 풀어서 구조 확인. 스크린샷은 test/shots/odb_*.png
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const root = path.join(__dirname, '..'), shots = path.join(__dirname, 'shots'), out = path.join(__dirname, 'out');
fs.mkdirSync(shots, { recursive: true }); fs.mkdirSync(out, { recursive: true });
let fails = 0; const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
(async () => {
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, acceptDownloads: true }), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file:///' + path.join(root, 'DXF_to_ODB.html').replace(/\\/g, '/'));
  const done = () => page.waitForFunction(() => window.__app.S.result && !window.__app.S.busy, null, { timeout: 600000 });
  const file = process.argv[2];
  if (file) await page.setInputFiles('#file', file); else await page.click('#btnExample');
  await done(); await page.waitForTimeout(300);
  for (const [sel, ext] of [['#btnOdbTgz', '.tgz'], ['#btnOdbZip', '.zip']]) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click(sel)]);
    const f = path.join(out, 'b_' + dl.suggestedFilename()); await dl.saveAs(f);
    const dir = path.join(out, 'b_odb' + ext.replace('.', '_')); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
    let ok = false, info = '';
    try { if (ext === '.tgz') cp.execFileSync('tar', ['xzf', f, '-C', dir]); else cp.execFileSync('unzip', ['-q', f, '-d', dir]); const job = fs.readdirSync(dir)[0]; ok = fs.existsSync(path.join(dir, job, 'matrix', 'matrix')) && fs.existsSync(path.join(dir, job, 'steps', 'panel', 'stephdr')) && fs.existsSync(path.join(dir, job, 'misc', 'info')); info = dl.suggestedFilename() + ' ' + (fs.statSync(f).size / 1e3).toFixed(1) + 'KB, 작업 ' + job; } catch (e) { info = String(e).slice(0, 150); }
    check('ODB++ ' + ext + ' 내려받아 풀기', dl.suggestedFilename().endsWith('_odb' + ext) && ok, info);
    const msg = await page.textContent('#odbMsg');
    check('  다시 읽기 대조 일치 표시', msg.includes('모두 Gerber 결과와 일치'), msg.slice(0, 160));
  }
  await page.selectOption('#oOdbUnit', 'mm'); await page.uncheck('#oOdbStep');
  { const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnOdbTgz')]); await dl.saveAs(path.join(out, 'b_mm_flat.tgz')); const msg = await page.textContent('#odbMsg'); check('mm · 스텝 끔', msg.includes('모두 Gerber 결과와 일치') && msg.includes('스텝 묶기 꺼짐'), msg.slice(0, 140)); }
  await page.evaluate(() => document.getElementById('btnOdbTgz').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(shots, 'odb_panel.png') });
  check('콘솔 오류 없음', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
