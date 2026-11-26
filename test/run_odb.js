// ODB++ 출력 검증: 변환 → ODB++ 쓰기 → 다시 읽어 Gerber 결과와 요소별 대조.
// 사용: node test/run_odb.js [dxf 파일]   (파일을 주면 그 도면으로, 없으면 예제 도면 + 블록 배열 도면)
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), cp = require('child_process');
const html = fs.readFileSync(path.join(__dirname, '..', 'DXF_to_Gerber.html'), 'utf8');
vm.runInThisContext(/<script>([\s\S]*)<\/script>/.exec(html)[1], { filename: 'DXF_to_ODB.js' });
let fails = 0; const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
const cfg = (layers, extra) => Object.assign({ layers, files: { cu1: 'a_L1.gbr', cu2: 'a_L2.gbr', mask: 'a_SM.gbr' }, mirror: {}, origin: 'dxf', ratio: 4, grid: 0.002, thr: 0.005, apTol: 0.0001, noMacro: false, ellN: 48, allVoid: false, overrides: {}, voids: {} }, extra || {});
async function one(label, dxfText, layers, extra, expectSteps) {
  const base = buildBase(parseDxf(dxfText), 'auto', true), R = await convertAll(base, cfg(layers, extra));
  console.log('\n== ' + label + ' (블록 삽입 ' + base.insts.length + '개)');
  for (const L of R.layers) check(L.label + ' 형상 비교 기준 이내', L.verify.nBad === 0, '최대 ' + L.verify.worst.toFixed(5));
  let last = null;
  for (const units of ['inch', 'mm']) for (const steps of [true, false]) {
    const t = Date.now(), odb = buildOdb(R, base, { job: 'test', units, steps, apTol: 0.0001, ellN: 48 }), c = checkOdb(odb, R);
    check('ODB++ ' + units + (steps ? ' 스텝' : ' 평면') + ' 다시 읽기 대조', c.ok, '요소 ' + c.total + ' 빠짐 ' + c.miss + ' 남음 ' + c.extra + ' 오류 ' + c.errors + ' | 스텝 ' + odb.steps.length + '종 ' + odb.nInst + '곳 (반복 줄 ' + odb.nSr + ') | ' + (odb.bytes / 1e6).toFixed(2) + 'MB ' + (Date.now() - t) + 'ms' + (c.at ? ' @' + c.at.map(v => v.toFixed(3)) : '') + (odb.noStepWhy ? ' [' + odb.noStepWhy + ']' : ''));
    if (steps && expectSteps) check('  스텝으로 묶임', odb.steps.length > 0 && odb.nInst >= expectSteps, odb.steps.slice(0, 6).map(s => s.name + '×' + s.count).join(' '));
    if (steps && units === 'inch') last = { odb, R };
  }
  return last;
}
(async () => {
  const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
  if (process.argv[2]) { const r = await one(path.basename(process.argv[2]), fs.readFileSync(process.argv[2], 'utf8'), { COPPER: 'cu1' }, {}, 0); fs.writeFileSync(path.join(out, 'odb_arg.tgz'), zlib.gzipSync(Buffer.from(makeTar(r.odb.files, r.odb.job)))); console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과'); process.exit(fails ? 1 : 0); }
  const ex = await one('예제 도면', makeExampleDxf(), { L1_TOP: 'cu1', L2_BOT: 'cu2', SM_TOP: 'mask', SM_BOT: 'mask2', OUTLINE: 'outline' }, {}, 0);
  check('5개 층 + 외형 profile', ex.odb.layers.join() === 'sm,l1,l2,sm2,outline' && /OC /.test(ex.odb.files.get('steps/panel/profile')), ex.odb.layers.join());
  await one('예제 도면(안쪽 폴리선 번갈아, 매크로 대신 영역)', makeExampleDxf(), { L1_TOP: 'cu1', L2_BOT: 'cu2', SM_TOP: 'mask', SM_BOT: 'mask2', OUTLINE: 'outline' }, { allVoid: true, noMacro: true }, 4); // 빈 곳이 있는 층도 블록 기준으로 묶인다
  // 블록 배열: 패드 2개 + 꺾임 R 배선 + 칸 경계에서 잘린 세로 레일(열린 선)로 된 칸을 6×8 배열
  const o = []; const w = (c, v) => o.push(String(c), String(v)), B = Math.tan(Math.PI / 8);
  const pl = (layer, pts, closed) => { w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(70, closed ? 1 : 0); for (const p of pts) { w(0, 'VERTEX'); w(8, layer); w(10, p[0]); w(20, p[1]); if (p[2]) w(42, p[2]); } w(0, 'SEQEND'); };
  w(0, 'SECTION'); w(2, 'BLOCKS'); w(0, 'BLOCK'); w(8, '0'); w(2, 'CELL'); w(70, 0); w(10, 0); w(20, 0); w(30, 0); w(3, 'CELL');
  pl('COPPER', [[1, 1], [1.6, 1], [1.6, 1.6], [1, 1.6]], true); pl('COPPER', [[3, 2.4], [3.6, 2.4], [3.6, 3], [3, 3]], true);
  pl('COPPER', [[1.6, 1.2], [3.35, 1.2, B], [3.4, 1.25], [3.4, 2.4], [3.2, 2.4], [3.2, 1.45, -B], [3.15, 1.4], [1.6, 1.4]], true);
  pl('COPPER', [[0.5, 0], [0.5, 1.25], [1, 1.25], [1, 1.4], [0.5, 1.4], [0.5, 4]], false); // 세로 레일(폭 0.3)의 오른쪽 변 + 패드로 가는 가지. 칸 경계에서 잘린 열린 선
  pl('COPPER', [[0.2, 4], [0.2, 0]], false);                                               // 레일 왼쪽 변
  w(0, 'ENDBLK'); w(0, 'ENDSEC'); w(0, 'SECTION'); w(2, 'ENTITIES');
  w(0, 'INSERT'); w(8, '0'); w(2, 'CELL'); w(10, 5); w(20, 10); w(70, 6); w(71, 8); w(44, 4.5); w(45, 4);
  pl('COPPER', [[2, 2], [40, 2], [40, 3], [2, 3]], true); // 블록 밖 도형
  for (let c = 0; c < 6; c++) { const X = 5 + c * 4.5; pl('COPPER', [[X + 0.2, 10], [X + 0.5, 10]], false); pl('COPPER', [[X + 0.5, 42], [X + 0.2, 42]], false); } // 레일 양 끝 마감(블록 밖)
  w(0, 'ENDSEC'); w(0, 'EOF');
  fs.writeFileSync(path.join(out, 'odb_cells.dxf'), o.join('\n'));
  const r2 = await one('블록 배열 6×8', o.join('\n'), { COPPER: 'cu1' }, {}, 48);
  { const b3 = buildBase(parseDxf(o.join('\n')), 'auto', true); check('잘린 레일을 이어 칸마다 다시 자름', b3.joined.loops === 6 && b3.joined.cut === 6 && b3.shapes.filter(q => q.inst >= 0).length === 48 * 4, JSON.stringify(b3.joined) + ' 주인 있는 도형 ' + b3.shapes.filter(q => q.inst >= 0).length); check('  스텝 3종(아래 줄·가운데·위 줄)', r2.odb.steps.length === 3, r2.odb.steps.map(q => q.name + '×' + q.count).join(' ')); }
  // 블록 안의 블록: 칸 배열 전체를 블록 PANEL에 넣고 한 번만 삽입(오토캐드 배열·묶음 블록과 같은 꼴) + 한 번만 쓴 블록 LOGO
  {
    const src = o.join('\n'), i0 = src.indexOf('0\nENDSEC'), ents = src.slice(src.indexOf('2\nENTITIES') + 11, src.lastIndexOf('0\nENDSEC'));
    const nested = src.slice(0, i0) + '0\nBLOCK\n8\n0\n2\nPANEL\n70\n0\n10\n0\n20\n0\n30\n0\n3\nPANEL\n' + ents + '0\nENDBLK\n0\nBLOCK\n8\n0\n2\nLOGO\n70\n0\n10\n0\n20\n0\n30\n0\n3\nLOGO\n0\nCIRCLE\n8\nCOPPER\n10\n0\n20\n0\n40\n0.5\n0\nENDBLK\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nINSERT\n8\n0\n2\nPANEL\n10\n100\n20\n50\n0\nINSERT\n8\n0\n2\nLOGO\n10\n90\n20\n50\n0\nENDSEC\n0\nEOF';
    const r3 = await one('블록 안의 블록(칸 배열을 블록 하나에 넣어 한 번 삽입)', nested, { COPPER: 'cu1' }, {}, 48);
    const b4 = buildBase(parseDxf(nested), 'auto', true);
    check('  안쪽 삽입 48개가 스텝 후보', b4.insts.length === 48 && b4.instStat.n === 50 && b4.instStat.top === 2 && b4.instStat.deep === 48, JSON.stringify(b4.instStat));
    check('  스텝 3종(가운데·아래 줄·위 줄)', r3.odb.steps.map(s => s.count).join() === '36,6,6', r3.odb.steps.map(s => s.name + '×' + s.count).join(' '));
  }
  // 블록 없이 그린 반복 무늬: 패드 간격에서 반복 칸을 찾아 스텝으로 묶는다(사용자 실도면: 동박이 블록 밖)
  {
    const o2 = []; const w2 = (c, v) => o2.push(String(c), String(v));
    const pl2 = pts => { w2(0, 'POLYLINE'); w2(8, 'COPPER'); w2(66, 1); w2(70, 1); for (const p of pts) { w2(0, 'VERTEX'); w2(8, 'COPPER'); w2(10, p[0]); w2(20, p[1]); if (p[2]) w2(42, p[2]); } w2(0, 'SEQEND'); };
    w2(0, 'SECTION'); w2(2, 'ENTITIES');
    for (let c = 0; c < 12; c++) for (let r = 0; r < 9; r++) { const X = 7.3 + c * 4.2, Y = 11.7 + r * 3.9, m = pts => pl2(pts.map(p => [X + p[0], Y + p[1], p[2]]));
      m([[1, 1], [1.6, 1], [1.6, 1.6], [1, 1.6]]); m([[3, 2.4], [3.6, 2.4], [3.6, 3], [3, 3]]);
      m([[1.6, 1.2], [3.35, 1.2, B], [3.4, 1.25], [3.4, 2.4], [3.2, 2.4], [3.2, 1.45, -B], [3.15, 1.4], [1.6, 1.4]]); }
    for (let c = 0; c < 12; c++) { const X = 7.3 + c * 4.2; pl2([[X + 0.2, 11], [X + 0.5, 11], [X + 0.5, 48], [X + 0.2, 48]]); } // 기판 길이 레일(칸보다 훨씬 큼 → 패널에)
    pl2([[2, 2], [5, 2], [5, 5], [2, 5]]);
    w2(0, 'ENDSEC'); w2(0, 'EOF');
    const base5 = buildBase(parseDxf(o2.join('\n')), 'auto', true), R5 = await convertAll(base5, cfg({ COPPER: 'cu1' }, {}));
    console.log('\n== 블록 없는 반복 무늬 12×9');
    for (const units of ['inch', 'mm']) {
      const odb = buildOdb(R5, base5, { job: 'test', units, steps: true, apTol: 0.0001, ellN: 48 }), c = checkOdb(odb, R5);
      check('ODB++ ' + units + ' 반복 칸 자동 다시 읽기 대조', c.ok, '요소 ' + c.total + ' 빠짐 ' + c.miss + ' 남음 ' + c.extra + ' | ' + (odb.bytes / 1e6).toFixed(3) + 'MB');
      check('  피치 4.2 × 3.9, 칸 108개가 스텝 하나(레일 끝 칸은 따로)', odb.mode === 'cell' && odb.cell && Math.abs(odb.cell.px - 4.2) < 1e-9 && Math.abs(odb.cell.py - 3.9) < 1e-9 && odb.steps.length <= 3 && odb.steps[0].count === 108 && odb.nSr <= 3, JSON.stringify(odb.cell) + ' ' + odb.steps.map(s => s.name + '×' + s.count).join(' ') + ' 반복 줄 ' + odb.nSr);
    }
    const flat = buildOdb(R5, base5, { job: 'test', units: 'mm', steps: false, apTol: 0.0001, ellN: 48 }); check('  스텝 끄면 평면', flat.steps.length === 0 && checkOdb(flat, R5).ok);
    // 최소 반복 수: CAM은 반복 배치 줄마다 블록 패드 한 줄을 만든다 → 스텝 하나 = 배열 하나(이름이 겹치지 않음), 적게 반복되는 조각은 패널에 푼다
    { const o100 = buildOdb(R5, base5, { job: 'test', units: 'mm', steps: true, minRep: 100, apTol: 0.0001, ellN: 48 }), c100 = checkOdb(o100, R5);
      check('  최소 반복 100: 108칸 배열만 스텝, 나머지는 패널에', c100.ok && o100.steps.length === 1 && o100.steps[0].count === 108 && o100.steps[0].nx * o100.steps[0].ny === 108 && o100.nFlatCell === 24, o100.steps.map(s => s.name + ' ' + s.nx + '×' + s.ny).join(' ') + ' 푼 칸 ' + o100.nFlatCell);
      // 가운데 칸 하나에 다른 도형을 넣어 배열이 여러 조각으로 갈리게 한다 → 조각마다 이름이 달라야 한다
      const o9 = o2.slice(0, o2.length - 4), n9 = o2.length; const keepO2 = o2.slice(); o2.length = 0; for (const q of o9) o2.push(q); pl2([[7.3 + 5 * 4.2 + 2.2, 11.7 + 4 * 3.9 + 0.2], [7.3 + 5 * 4.2 + 2.6, 11.7 + 4 * 3.9 + 0.2], [7.3 + 5 * 4.2 + 2.6, 11.7 + 4 * 3.9 + 0.6], [7.3 + 5 * 4.2 + 2.2, 11.7 + 4 * 3.9 + 0.6]]); w2(0, 'ENDSEC'); w2(0, 'EOF');
      const b9 = buildBase(parseDxf(o2.join('\n')), 'auto', true), R9 = await convertAll(b9, cfg({ COPPER: 'cu1' }, {})); o2.length = 0; for (const q of keepO2) o2.push(q);
      const s9 = buildOdb(R9, b9, { job: 'test', units: 'mm', steps: true, apTol: 0.0001, ellN: 48 }), k9 = checkOdb(s9, R9), names = s9.steps.map(s => s.name);
      const hdr = s9.files.get('steps/panel/stephdr'), nrec = (hdr.match(/STEP-REPEAT \{/g) || []).length;
      check('  배열이 갈려도 스텝 이름이 겹치지 않고 반복 줄 = 스텝 수', k9.ok && new Set(names).size === names.length && nrec === names.length && s9.nKinds < names.length, '스텝 ' + names.length + '개(내용 ' + s9.nKinds + '종), 반복 줄 ' + nrec + ' | ' + s9.steps.slice(0, 6).map(s => s.name + ' ' + s.nx + '×' + s.ny).join(' '));
    }
    // 배열 조각 나누기: CAM이 피치를 반올림해 간직하면 칸 수만큼 오차가 쌓인다 → 조각마다 위치를 따로 적어 누적을 끊는다
    { const oM = buildOdb(R5, base5, { job: 'test', units: 'mm', steps: true, minRep: 100, maxN: 5, apTol: 0.0001, ellN: 48 }), cM = checkOdb(oM, R5), nm = oM.steps.map(s => s.name);
      check('  최대 칸 수 5: 108칸 배열이 5×5 이하 조각으로, 합은 그대로, 이름 유일', cM.ok && oM.steps.every(s => s.nx <= 5 && s.ny <= 5) && oM.nInst === 108 && oM.steps.length > 1 && new Set(nm).size === nm.length && oM.nFlatCell === 24, oM.steps.map(s => s.nx + '×' + s.ny).join(' '));
      // 피치를 inch 소수 6자리로 반올림해 읽는 CAM을 흉내 내어, 가장 먼 칸의 위치 오차가 줄어드는지 본다
      const worst = o => { let m = 0; const h = o.files.get('steps/panel/stephdr'); for (const b of h.split('STEP-REPEAT {').slice(1)) { const g = k => +new RegExp('\\b' + k + '=(\\S+)').exec(b)[1], rd = v => Math.round(v / 25.4 * 1e6) / 1e6 * 25.4; m = Math.max(m, Math.abs((rd(g('DX')) - g('DX')) * (g('NX') - 1)), Math.abs((rd(g('DY')) - g('DY')) * (g('NY') - 1))); } return m; };
      const o0 = buildOdb(R5, base5, { job: 'test', units: 'mm', steps: true, minRep: 100, apTol: 0.0001, ellN: 48 });
      check('  피치를 inch 6자리로 읽는 CAM을 가정하면 누적 오차가 줄어듦', worst(oM) < worst(o0) * 0.5, (worst(o0) * 1000).toFixed(4) + 'µm → ' + (worst(oM) * 1000).toFixed(4) + 'µm'); }
    // 스텝 위치 보정: CAM이 스텝 배치 좌표를 0.03937(= 1/25.4를 줄인 값)로 바꿔 읽는다고 보면 2.0003ppm 모자란다 → 그만큼 늘려 적으면 위치가 맞는다
    { const oP = buildOdb(R5, base5, { job: 'test', units: 'mm', steps: true, minRep: 100, srPpm: 2, apTol: 0.0001, ellN: 48 }), cP = checkOdb(oP, R5), h = oP.files.get('steps/panel/stephdr');
      const g = k => +new RegExp('\\b' + k + '=(\\S+)').exec(h)[1], cam = v => v * 0.03937 * 25.4, far = 590 / 4.2;
      check('  스텝 위치 보정 2ppm: DX 4.2 → 4.200008, 다시 읽기 대조 일치(되돌려 읽음)', cP.ok && Math.abs(g('DX') - 4.2000084) < 6e-7 && Math.abs(g('DY') - 3.9000078) < 6e-7, 'DX ' + g('DX') + ' DY ' + g('DY'));
      check('  0.03937로 읽는 CAM을 가정: 590mm 지점 오차 1.18µm → 0.1µm 미만', Math.abs(cam(4.2) * far - 590) > 1.1e-3 && Math.abs(cam(g('DX')) * far - 590) < 1e-4, (Math.abs(cam(4.2) * far - 590) * 1000).toFixed(3) + 'µm → ' + (Math.abs(cam(g('DX')) * far - 590) * 1000).toFixed(3) + 'µm'); }
    { const o7 = buildOdb(R5, base5, { job: 'test', units: 'mm', steps: true, apTol: 0.0001, ellN: 48, pitchAll: true }), c7 = checkOdb(o7, R5);
      check('  패드 없이 선·영역 중심만으로도 같은 피치', c7.ok && o7.pitchInfo.all && Math.abs(o7.cell.px - 4.2) < 1e-9 && Math.abs(o7.cell.py - 3.9) < 1e-9 && o7.steps[0].count === 108, JSON.stringify(o7.pitchInfo)); }
    // 빈 곳(음각)이 있는 층: 칸마다 큰 사각 안에 빈 곳, 그 안에 섬. "번갈아" 옵션을 켜도 스텝으로 묶이고 그리는 순서(동박 → 빈 곳 → 섬)가 지켜져야 한다
    const o3 = o2.slice(0, o2.length - 4); { const sv = o2.length; o2.length = 0; for (const q of o3) o2.push(q);
      for (let c = 0; c < 12; c++) for (let r = 0; r < 9; r++) { const X = 7.3 + c * 4.2, Y = 11.7 + r * 3.9; for (const [a, b] of [[0, 1.2], [0.3, 0.9], [0.5, 0.7]]) pl2([[X + 1.9 + a, Y + 0.05 + a * 0.5], [X + 1.9 + b, Y + 0.05 + a * 0.5], [X + 1.9 + b, Y + 0.95 - a * 0.5], [X + 1.9 + a, Y + 0.95 - a * 0.5]]); }
      w2(0, 'ENDSEC'); w2(0, 'EOF'); }
    const base6 = buildBase(parseDxf(o2.join('\n')), 'auto', true), R6 = await convertAll(base6, cfg({ COPPER: 'cu1' }, { allVoid: true }));
    console.log('\n== 블록 없는 반복 무늬 + 빈 곳(번갈아)');
    check('동박 1 형상 비교 기준 이내', R6.layers[0].verify.nBad === 0, '최대 ' + R6.layers[0].verify.worst.toFixed(5) + ' 빈 곳 ' + R6.layers[0].shapes.filter(s => s.level === 1).length);
    const odb6 = buildOdb(R6, base6, { job: 'test', units: 'mm', steps: true, apTol: 0.0001, ellN: 48 }), c6 = checkOdb(odb6, R6);
    check('ODB++ 반복 칸 자동(빈 곳 있는 층) 다시 읽기 대조', c6.ok, '요소 ' + c6.total + ' 빠짐 ' + c6.miss + ' 남음 ' + c6.extra + ' | ' + odb6.steps.map(s => s.name + '×' + s.count).join(' '));
    const f6 = odb6.steps.length ? odb6.files.get('steps/' + odb6.steps[0].name + '/layers/l1/features').split('\n').filter(l => /^[LPS] /.test(l)).map(l => / N /.test(l) ? 'N' : 'P').join('') : '';
    check('  칸 108개가 스텝 하나, 빈 곳은 바깥 동박 뒤·섬 앞', odb6.steps.length && odb6.steps[0].count === 108 && /^P+NP+$/.test(f6) && f6.indexOf('N') > 0, f6);
  }
  // 큰 호가 있는 영역(P20급 도면): 반원(꼭짓점 2개, 호가 대부분)과 큰 호 면. 윤곽 방향(섬 = 시계 방향)과 다시 읽기 대조가 맞아야 한다
  {
    const o8 = []; const w8 = (c, v) => o8.push(String(c), String(v));
    const pl8 = pts => { w8(0, 'POLYLINE'); w8(8, 'COPPER'); w8(66, 1); w8(70, 1); for (const p of pts) { w8(0, 'VERTEX'); w8(8, 'COPPER'); w8(10, p[0]); w8(20, p[1]); if (p[2]) w8(42, p[2]); } w8(0, 'SEQEND'); };
    w8(0, 'SECTION'); w8(2, 'ENTITIES');
    for (let c = 0; c < 6; c++) for (let r = 0; r < 4; r++) { const X = 10 + c * 20, Y = 10 + r * 20;
      pl8([[X, Y], [X + 1, Y], [X + 1, Y + 1], [X, Y + 1]]); pl8([[X + 3, Y], [X + 4, Y], [X + 4, Y + 1], [X + 3, Y + 1]]);
      pl8([[X + 6, Y + 2], [X + 12, Y + 2, 1]]); pl8([[X + 12, Y + 6], [X + 6, Y + 6, 1]]); pl8([[X + 2, Y + 8], [X + 12, Y + 8, 0.3], [X + 12, Y + 12], [X + 2, Y + 12, 0.2]]); }
    w8(0, 'ENDSEC'); w8(0, 'EOF');
    const base8 = buildBase(parseDxf(o8.join('\n')), 'auto', true), R8 = await convertAll(base8, cfg({ COPPER: 'cu1' }, {}));
    console.log('\n== 큰 호가 있는 영역 6×4');
    { const oa = buildOdb(R8, base8, { job: 'test', units: 'mm', steps: true, apTol: 0.0001, ellN: 48 }), ob = buildOdb(R8, base8, { job: 'test', units: 'mm', steps: true, arcPoly: false, apTol: 0.0001, ellN: 48 });
      const nOC = o => { let n = 0; for (const [p, x] of o.files) if (p.indexOf('/features') > 0) n += (x.match(/^OC /gm) || []).length; return n; };
      check('영역의 호를 꺾은선으로(기본): 영역·심벌에 OC 없음, 끄면 OC 있음', nOC(oa) === 0 && nOC(ob) > 0 && checkOdb(oa, R8).ok && checkOdb(ob, R8).ok, 'OC ' + nOC(oa) + ' / 끄면 ' + nOC(ob) + ' | ' + (oa.bytes / 1e3).toFixed(1) + 'KB / ' + (ob.bytes / 1e3).toFixed(1) + 'KB'); }
    for (const arcPoly of [true, false]) for (const steps of [false, true]) { const odb = buildOdb(R8, base8, { job: 'test', units: 'mm', steps, arcPoly, apTol: 0.0001, ellN: 48 }), c = checkOdb(odb, R8);
      check('ODB++ ' + (steps ? '스텝' : '평면') + (arcPoly ? '' : ' · 호 그대로') + ' 다시 읽기 대조(윤곽 방향 포함)', c.ok && c.errors === 0, '요소 ' + c.total + ' 빠짐 ' + c.miss + ' 남음 ' + c.extra + ' 오류 ' + c.errors + ' | ' + odb.steps.map(s => s.name + '×' + s.count).join(' ')); }
  }
  // 블록 안에 빈 곳이 있는 도형(사각 안의 사각 안의 사각): "번갈아"를 켜도 블록 기준 스텝으로 묶이고, 스텝 안에서 동박 → 빈 곳 → 섬 순서가 지켜져야 한다
  {
    const ob = [], wb = (c, v) => ob.push(String(c), String(v)), plb = pts => { wb(0, 'POLYLINE'); wb(8, 'COPPER'); wb(66, 1); wb(70, 1); for (const p of pts) { wb(0, 'VERTEX'); wb(8, 'COPPER'); wb(10, p[0]); wb(20, p[1]); } wb(0, 'SEQEND'); };
    wb(0, 'SECTION'); wb(2, 'BLOCKS'); wb(0, 'BLOCK'); wb(8, '0'); wb(2, 'RING'); wb(70, 0); wb(10, 0); wb(20, 0); wb(30, 0); wb(3, 'RING');
    for (const [a, b] of [[0, 3], [0.6, 2.4], [1.1, 1.9]]) plb([[a, a], [b, a], [b, b], [a, b]]);
    plb([[3.5, 0.5], [4.2, 0.5], [4.2, 1.2], [3.5, 1.2]]);
    wb(0, 'ENDBLK'); wb(0, 'ENDSEC'); wb(0, 'SECTION'); wb(2, 'ENTITIES');
    wb(0, 'INSERT'); wb(8, '0'); wb(2, 'RING'); wb(10, 5); wb(20, 5); wb(70, 4); wb(71, 3); wb(44, 6); wb(45, 5);
    wb(0, 'ENDSEC'); wb(0, 'EOF');
    const bR = buildBase(parseDxf(ob.join('\n')), 'auto', true), RR = await convertAll(bR, cfg({ COPPER: 'cu1' }, { allVoid: true }));
    console.log('\n== 블록 안에 빈 곳이 있는 도형 4×3(번갈아)');
    const oR = buildOdb(RR, bR, { job: 'test', units: 'mm', steps: true, apTol: 0.0001, ellN: 48 }), cR = checkOdb(oR, RR);
    const fR = oR.steps.length ? oR.files.get('steps/' + oR.steps[0].name + '/layers/l1/features').split('\n').filter(l => /^[LPS] /.test(l)).map(l => / N /.test(l) ? 'N' : 'P').join('') : '';
    check('블록 기준으로 12곳이 스텝 하나, 빈 곳은 바깥 동박 뒤·섬 앞', cR.ok && oR.mode === 'block' && oR.steps.length === 1 && oR.steps[0].count === 12 && /^P+NP+$/.test(fR), '방식 ' + oR.mode + ' | ' + oR.steps.map(s => s.name + '×' + s.count).join(' ') + ' | 순서 ' + fR + ' | 요소 ' + cR.total + ' 빠짐 ' + cR.miss + ' 남음 ' + cR.extra);
  }
  {
    console.log('\n== ODB++ 층 이름 바꾸기 · 따로 출력하는 레이어');
    const bN = buildBase(parseDxf(makeExampleDxf()), 'auto', true), RN = await convertAll(bN, cfg({ L1_TOP: 'cu1', L2_BOT: 'xc:L2_BOT', SM_TOP: 'mask', SM_BOT: 'xm:SM_BOT', OUTLINE: 'outline', '치수': 'xo:치수' }));
    const oD = buildOdb(RN, bN, { job: 't', units: 'mm', steps: false }), cD = checkOdb(oD, RN);
    check('기본 이름: 따로 출력 층은 DXF 레이어 이름에서', cD.ok && oD.layers.join() === 'sm,l1,l2_bot,outline,sm_bot,layer', oD.layers.join());
    const oN = buildOdb(RN, bN, { job: 't', units: 'mm', steps: false, names: { cu1: 'TOP Copper', 'xc:L2_BOT': 'top_copper', mask: 'smt', outline: 'rout' } }), cN = checkOdb(oN, RN), mxN = oN.files.get('matrix/matrix');
    check('고친 이름이 matrix·폴더에 쓰이고 겹치면 번호', cN.ok && oN.layers.join() === 'smt,top_copper,top_copper_2,rout,sm_bot,layer' && /NAME=TOP_COPPER\n/.test(mxN) && /NAME=TOP_COPPER_2\n/.test(mxN) && oN.files.has('steps/panel/layers/top_copper_2/features') && oN.files.has('steps/panel/layers/rout/features') && !oN.files.has('steps/panel/layers/l1/features'), oN.layers.join() + ' | 요소 ' + cN.total + ' 빠짐 ' + cN.miss + ' 남음 ' + cN.extra);
    check('층 종류: 동박 = SIGNAL, 면(이름이 마스크) = SOLDER_MASK, 그 밖 = DOCUMENT', /TYPE=SIGNAL\n\s+NAME=TOP_COPPER_2/.test(mxN) && /TYPE=SOLDER_MASK\n\s+NAME=SM_BOT/.test(mxN) && /TYPE=DOCUMENT\n\s+NAME=LAYER/.test(mxN));
  }
  // tar.gz 묶음을 실제로 풀어 본다
  for (const [nm, r] of [['odb_example', ex], ['odb_cells', r2]]) {
    const tgz = path.join(out, nm + '.tgz'); fs.writeFileSync(tgz, zlib.gzipSync(Buffer.from(makeTar(r.odb.files, r.odb.job))));
    const dir = path.join(out, nm); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
    let ok = true, msg = ''; try { cp.execFileSync('tar', ['xzf', tgz, '-C', dir]); const m = fs.readFileSync(path.join(dir, r.odb.job, 'matrix', 'matrix'), 'utf8'); ok = m.includes('STEP {') && fs.existsSync(path.join(dir, r.odb.job, 'steps', 'panel', 'layers', r.odb.layers[0], 'features')); msg = r.odb.files.size + '개 파일'; } catch (e) { ok = false; msg = String(e).slice(0, 120); }
    check(nm + '.tgz 풀기', ok, msg);
  }
  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
