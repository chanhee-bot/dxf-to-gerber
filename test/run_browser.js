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
  await page.check('#oAuto'); // 기존 시험은 '설정을 바꾸면 바로 변환'을 켜고 돌린다
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

  // 여러 객체 선택: Ctrl+클릭, 상자 끌기, 한꺼번에 바꾸기
  {
    const role = (x, y) => page.evaluate(([x, y]) => { const L = window.__app.S.result.layers.find(l => l.target === 'cu1'); let b = null; for (const s of L.shapes) if (!s.dup && x >= s.bbox[0] && x <= s.bbox[2] && y >= s.bbox[1] && y <= s.bbox[3] && (!b || s.area < b.area)) b = s; return b ? b.role : null; }, [x, y]);
    await page.selectOption('#oOrigin', 'dxf'); await done(); await page.selectOption('#vColor', 'kind'); await page.waitForTimeout(100);
    for (const id of ['show_cu2', 'show_mask', 'show_mask2', 'show_outline']) if (await page.$('#' + id)) await page.uncheck('#' + id);
    await zoom([0, 0, 14, 4]); await page.waitForTimeout(200);
    let a = await toScreen(2, 2), b = await toScreen(12, 2);
    await page.mouse.click(a[0], a[1]);
    await page.keyboard.down('Control'); await page.mouse.click(b[0], b[1]); await page.keyboard.up('Control');
    check('Ctrl+클릭으로 2개 선택', (await page.textContent('#pop')).includes('객체 2개 선택'), (await page.textContent('#pop')).slice(0, 60));
    await page.screenshot({ path: path.join(shots, '9_multi_select.png') });
    await page.click('#pop button[data-role=trace]'); await done(); await page.waitForTimeout(200);
    check('한꺼번에 배선으로', (await role(2, 2)) === 'trace' && (await role(12, 2)) === 'trace', (await role(2, 2)) + ',' + (await role(12, 2)));
    check('바꾼 뒤에도 선택 유지', (await page.textContent('#pop')).includes('객체 2개 선택'));
    await page.click('#pop button[data-role=auto]'); await done(); await page.waitForTimeout(200);
    check('한꺼번에 자동으로 되돌림', (await role(2, 2)) === 'pad' && (await role(12, 2)) === 'pad');
    await page.keyboard.press('Escape');
    check('Esc로 선택 해제', !(await page.isVisible('#pop')) && (await page.evaluate(() => window.__app.V.sels.length)) === 0);
    // 상자 선택: 왼쪽→오른쪽(다 들어온 것만), 오른쪽→왼쪽(걸친 것도)
    await page.check('#vBox');
    let p0 = await toScreen(1, 0.8), p1 = await toScreen(13, 3.2);
    await page.mouse.move(p0[0], p0[1]); await page.mouse.down(); await page.mouse.move((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2); await page.screenshot({ path: path.join(shots, '10_box_select.png') }); await page.mouse.move(p1[0], p1[1]); await page.mouse.up();
    check('상자 선택(왼→오): 패드 2 + 배선 1', (await page.textContent('#pop')).includes('객체 3개 선택'), (await page.textContent('#pop')).slice(0, 80));
    await page.keyboard.press('Escape');
    p0 = await toScreen(3, 2.6); p1 = await toScreen(1.8, 1.6);
    await page.mouse.move(p0[0], p0[1]); await page.mouse.down(); await page.mouse.move(p1[0], p1[1], { steps: 3 }); await page.mouse.up();
    check('상자 선택(오→왼): 걸친 것 2개(패드 + 배선)', (await page.textContent('#pop')).includes('객체 2개 선택'), (await page.textContent('#pop')).slice(0, 80));
    await page.keyboard.press('Escape'); await page.uncheck('#vBox');
    // Shift+끌기는 '영역 선택'이 꺼져 있어도 상자 선택, 그냥 끌기는 화면 이동
    p0 = await toScreen(1, 0.8); p1 = await toScreen(13, 3.2);
    await page.keyboard.down('Shift'); await page.mouse.move(p0[0], p0[1]); await page.mouse.down(); await page.mouse.move(p1[0], p1[1], { steps: 3 }); await page.mouse.up(); await page.keyboard.up('Shift');
    check('Shift+끌기 상자 선택', (await page.textContent('#pop')).includes('객체 3개 선택'));
    await page.keyboard.press('Escape');
    const cx0 = await page.evaluate(() => window.__app.V.cx);
    await page.mouse.move(p0[0], p0[1]); await page.mouse.down(); await page.mouse.move(p0[0] + 80, p0[1], { steps: 3 }); await page.mouse.up();
    check('그냥 끌기는 화면 이동', (await page.evaluate(() => window.__app.V.cx)) < cx0 - 0.1 && (await page.evaluate(() => window.__app.V.sels.length)) === 0);
  }
  // '변환' 버튼 방식: 설정을 바꿔도 바로 변환하지 않고, 누르면 바뀐 층만 다시 변환
  {
    await page.uncheck('#oAuto');
    const stamp = () => page.evaluate(() => { const R = window.__app.S.result; return R ? R.layers.map(l => l.target + ':' + (l.reused ? 'keep' : 'new')).join(' ') : 'none'; });
    const gb = () => page.evaluate(() => window.__app.S.result.layers.find(l => l.target === 'mask').text.length);
    const before = await gb();
    await page.fill('#oOutW', '0.2'); await page.dispatchEvent('#oOutW', 'change'); await page.waitForTimeout(300);
    check('옵션을 바꿔도 바로 변환하지 않음(안내 표시, 내려받기 잠금)', (await page.isVisible('#dirtyBar')) && (await page.isDisabled('#dl_cu1')) && (await page.isDisabled('#btnZip')) && (await page.evaluate(() => window.__app.S.result.layers.find(l => l.target === 'outline').text.includes('C,0.1*'))), await page.textContent('#applyMsg'));
    await page.selectOption('#layerTbl select[data-layer="SM_BOT"]', 'none'); await page.waitForTimeout(200);
    check('레이어 지정을 바꿔도 바로 변환하지 않음', (await page.evaluate(() => window.__app.S.result.layers.length)) === 5);
    await page.screenshot({ path: path.join(shots, '11_apply_pending.png') });
    await page.click('#btnConvert'); await done(); await page.waitForTimeout(200);
    const st = await stamp();
    check('변환을 누르면 한 번에 반영, 바뀐 층만 다시 변환', st === 'cu1:keep cu2:keep mask:keep outline:new' && !(await page.isVisible('#dirtyBar')) && !(await page.isDisabled('#dl_cu1')) && (await page.evaluate(() => window.__app.S.result.layers.find(l => l.target === 'outline').text.includes('C,0.2*'))), st + ' | ' + (await page.textContent('#applyMsg')).slice(0, 90));
    check('그대로 쓴 층의 결과는 같음', (await gb()) === before);
    await page.screenshot({ path: path.join(shots, '12_apply_done.png') });
    // 미리보기에서 눌러 바꾸기: 바로 반영, 그 층만
    await zoom([0, 0, 14, 4]); await page.waitForTimeout(200);
    const a = await toScreen(2, 2); await page.mouse.click(a[0], a[1]); await page.waitForSelector('#pop button[data-role=trace]');
    await page.click('#pop button[data-role=trace]'); await done(); await page.waitForTimeout(200);
    check('눌러 바꾸기는 바로 반영, 그 층만 다시 변환', (await stamp()) === 'cu1:new cu2:keep mask:keep outline:keep', await stamp());
    await page.click('#pop button[data-role=auto]'); await done(); await page.keyboard.press('Escape');
    // 설정이 바뀐 채로 눌러 바꾸면 바뀐 설정은 아직 반영되지 않는다
    await page.fill('#oOutW', '0.1'); await page.dispatchEvent('#oOutW', 'change'); await page.waitForTimeout(200);
    await page.mouse.click(a[0], a[1]); await page.waitForSelector('#pop button[data-role=trace]'); await page.click('#pop button[data-role=trace]'); await done(); await page.waitForTimeout(200);
    check('설정이 바뀐 상태에서 눌러 바꿔도 미적용 설정은 그대로 대기', (await page.isVisible('#dirtyBar')) && (await page.evaluate(() => window.__app.S.result.layers.find(l => l.target === 'outline').text.includes('C,0.2*'))));
    await page.click('#pop button[data-role=auto]'); await done(); await page.keyboard.press('Escape');
    await page.click('#dirtyBar'); await done(); await page.waitForTimeout(200);
    check('안내 띠를 눌러도 변환', !(await page.isVisible('#dirtyBar')) && (await page.evaluate(() => window.__app.S.result.layers.find(l => l.target === 'outline').text.includes('C,0.1*'))));
    await page.check('#oAuto');
  }
  // 예제 버튼, 바이너리 DXF 안내
  await page.click('#btnExample'); await done();
  await page.uncheck('#oAuto'); await page.click('#btnExample'); await page.waitForTimeout(500);
  check('도면을 열어도 자동으로 변환하지 않음', (await page.evaluate(() => window.__app.S.result === null)) && (await page.isVisible('#dirtyBar')) && (await page.textContent('#sumBox')).includes('아직 변환하지 않았습니다'));
  await page.check('#oAuto'); await done();
  check('예제 도면 열기 버튼', (await page.textContent('#fileInfo')).includes('example.dxf'));
  fs.writeFileSync(path.join(out, 'binary.dxf'), Buffer.concat([Buffer.from('AutoCAD Binary DXF\r\n\x1a\0'), Buffer.alloc(40)]));
  await page.setInputFiles('#file', path.join(out, 'binary.dxf')); await page.waitForTimeout(300);
  check('바이너리 DXF 안내', (await page.textContent('#fileMsg')).includes('바이너리 DXF'));
  check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
