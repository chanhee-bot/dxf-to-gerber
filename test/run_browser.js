// 브라우저(Chromium) 실제 동작 확인. 먼저 node test/run_core.js 로 test/out/example.dxf 를 만든다.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const root = path.join(__dirname, '..'), shots = path.join(__dirname, 'shots'), out = path.join(__dirname, 'out');
fs.mkdirSync(shots, { recursive: true });
let fails = 0;
const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 950 }, acceptDownloads: true });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file:///' + path.join(root, process.env.HTML || 'DXF_to_Gerber.html').replace(/\\/g, '/'));
  check('빌드 표시', /빌드 \d{4}-\d{4}/.test(await page.textContent('#build')), await page.textContent('#build'));
  await page.screenshot({ path: path.join(shots, '0_empty.png') });

  const done = () => page.waitForFunction(() => window.__app.S.result && !window.__app.S.busy, null, { timeout: 60000 });
  await page.setInputFiles('#file', path.join(out, 'example.dxf'));
  await done(); await page.waitForTimeout(300);
  const info = await page.evaluate(() => { const R = window.__app.S.result; return { layers: R.layers.map(l => ({ t: l.target, stats: l.stats, bad: l.verify.nBad, worst: l.verify.worst, prims: l.prims.length, warn: l.warnings.length })), ms: R.ms }; });
  console.log(JSON.stringify(info));
  check('레이어 5개 출력(동박 1·2, 솔더마스크 1·2, 외형) 자동 지정', info.layers.map(l => l.t).join() === 'cu1,cu2,mask,mask2,outline', info.layers.map(l => l.t).join());
  check('형상 비교 기준 이내', info.layers.every(l => l.bad === 0));
  check('레이어 표 자동 지정', (await page.$$eval('#layerTbl select', a => a.map(s => s.dataset.layer + '=' + s.value).join(' '))).includes('L1_TOP=cu1'), await page.$$eval('#layerTbl select', a => a.map(s => s.dataset.layer + '=' + s.value).join(' ')));
  check('요약에 "모든 객체가 기준 이내"', (await page.textContent('#sumBox')).includes('모든 객체가 기준 이내'));
  await page.screenshot({ path: path.join(shots, '1_example_full.png') });

  // 캔버스가 실제로 그려졌는지(배경색이 아닌 픽셀 수)
  const painted = await page.evaluate(() => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) n++; return n; });
  check('미리보기에 그림이 있음', painted > 5000, painted + 'px');

  // 세계 좌표 → 화면 좌표
  const toScreen = (x, y) => page.evaluate(([x, y]) => { const V = window.__app.V, c = document.getElementById('cv'), r = c.getBoundingClientRect(); return [r.left + (c.width / 2 + (x - V.cx) * V.scale) / V.dpr, r.top + (c.height / 2 - (y - V.cy) * V.scale) / V.dpr]; }, [x, y]);
  const zoom = bb => page.evaluate(bb => { const V = window.__app.V, c = document.getElementById('cv'); V.cx = (bb[0] + bb[2]) / 2; V.cy = (bb[1] + bb[3]) / 2; V.scale = Math.min(c.width / (bb[2] - bb[0]), c.height / (bb[3] - bb[1])) * 0.9; document.getElementById('vOrig').dispatchEvent(new Event('change')); }, bb);

  // 확대: 꺾임·T자·폭 변화
  await zoom([1, 5, 23, 18]); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '2_traces.png') });
  await zoom([7.5, 5.6, 8.5, 6.4]); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '3_bend_corner.png') });
  await zoom([1, 22.5, 25, 29.5]); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '4_pads_blocks.png') });

  // 클릭으로 패드 → 배선 바꾸기
  await zoom([0, 0, 14, 4]); await page.waitForTimeout(200);
  let p = await toScreen(2, 2);
  await page.mouse.click(p[0], p[1]);
  await page.waitForSelector('#pop button[data-role=trace]');
  check('팝업 표시', (await page.textContent('#pop')).includes('사각 1×1.5'), (await page.textContent('#pop')).slice(0, 80));
  await page.screenshot({ path: path.join(shots, '5_popup.png') });
  await page.click('#pop button[data-role=trace]');
  await done(); await page.waitForTimeout(200);
  check('패드 판정 변경 목록', (await page.textContent('#ovBox')).includes('패드(플래시) → 배선(선)'), (await page.textContent('#ovBox')).slice(0, 80));
  check('바꾼 뒤에도 형상 기준 이내', await page.evaluate(() => window.__app.S.result.layers.every(l => l.verify.nBad === 0)));
  await page.click('#ovBox button'); await done();
  check('되돌리기', (await page.textContent('#ovBox')).includes('없음'));

  // 경고 목록 → 위치로 확대, 안쪽 폴리선을 빈 곳으로
  await page.click('#warnBox .item[data-wtype=nested]');
  await page.waitForSelector('#pop button[data-void=true]');
  await page.click('#pop button[data-void=true]'); await done(); await page.waitForTimeout(300);
  check('빈 곳 → LPC 출력', await page.evaluate(() => window.__app.S.result.layers[0].text.includes('%LPC*%')));
  check('빈 곳 처리 후 형상 기준 이내', await page.evaluate(() => window.__app.S.result.layers.every(l => l.verify.nBad === 0)));
  await zoom([15, 29, 23, 35]); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '6_void.png') });

  // 옵션: 매크로 대신 영역, 원점, 반전
  await page.check('#oNoMacro'); await done();
  check('매크로 대신 영역', await page.evaluate(() => !window.__app.S.result.layers[0].text.includes('%AM')));
  await page.uncheck('#oNoMacro'); await done();
  await page.selectOption('#oOrigin', 'll'); await done();
  check('좌하단 원점', await page.evaluate(() => Math.abs(window.__app.S.result.bbox[0]) < 1e-9));
  await page.check('#mir_cu2'); await done();
  check('2층 반전 후 형상 기준 이내', await page.evaluate(() => window.__app.S.result.layers.every(l => l.verify.nBad === 0)));
  await page.selectOption('#vColor', 'layer'); await page.click('#btnFit'); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '7_layer_colors.png') });

  // 내려받기
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl_cu1')]);
  let f = path.join(out, 'dl_' + dl.suggestedFilename()); await dl.saveAs(f);
  const g = fs.readFileSync(f, 'utf8');
  check('gbr 내려받기', dl.suggestedFilename() === 'example_L1.gbr' && g.includes('%FSLAX46Y46*%') && g.trim().endsWith('M02*'), dl.suggestedFilename());
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnZip')]);
  f = path.join(out, 'dl_' + dl.suggestedFilename()); await dl.saveAs(f);
  const z = fs.readFileSync(f);
  check('zip 내려받기', dl.suggestedFilename() === 'example_gerber.zip' && z.readUInt32LE(0) === 0x04034b50 && z.includes('example_SM1.gbr') && z.includes('example_SM2.gbr') && z.includes('example_OUTLINE.gbr'), dl.suggestedFilename() + ' ' + z.length + 'B');

  // 예제 버튼, 바이너리 DXF 안내
  await page.click('#btnExample'); await done();
  check('예제 도면 열기 버튼', (await page.textContent('#fileInfo')).includes('example.dxf'));
  fs.writeFileSync(path.join(out, 'binary.dxf'), Buffer.concat([Buffer.from('AutoCAD Binary DXF\r\n\x1a\0'), Buffer.alloc(40)]));
  await page.setInputFiles('#file', path.join(out, 'binary.dxf')); await page.waitForTimeout(300);
  check('바이너리 DXF 안내', (await page.textContent('#fileMsg')).includes('바이너리 DXF'));
  check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
