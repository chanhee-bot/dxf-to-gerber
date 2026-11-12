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
  await one('예제 도면(안쪽 폴리선 번갈아, 매크로 대신 영역)', makeExampleDxf(), { L1_TOP: 'cu1', L2_BOT: 'cu2', SM_TOP: 'mask', SM_BOT: 'mask2', OUTLINE: 'outline' }, { allVoid: true, noMacro: true }, 0);
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
  // tar.gz 묶음을 실제로 풀어 본다
  for (const [nm, r] of [['odb_example', ex], ['odb_cells', r2]]) {
    const tgz = path.join(out, nm + '.tgz'); fs.writeFileSync(tgz, zlib.gzipSync(Buffer.from(makeTar(r.odb.files, r.odb.job))));
    const dir = path.join(out, nm); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
    let ok = true, msg = ''; try { cp.execFileSync('tar', ['xzf', tgz, '-C', dir]); const m = fs.readFileSync(path.join(dir, r.odb.job, 'matrix', 'matrix'), 'utf8'); ok = m.includes('STEP {') && fs.existsSync(path.join(dir, r.odb.job, 'steps', 'panel', 'layers', r.odb.layers[0], 'features')); msg = r.odb.files.size + '개 파일'; } catch (e) { ok = false; msg = String(e).slice(0, 120); }
    check(nm + '.tgz 풀기', ok, msg);
  }
  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
