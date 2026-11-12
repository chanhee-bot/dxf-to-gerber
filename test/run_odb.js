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
  // tar.gz 묶음을 실제로 풀어 본다
  for (const [nm, r] of [['odb_example', ex], ['odb_cells', r2]]) {
    const tgz = path.join(out, nm + '.tgz'); fs.writeFileSync(tgz, zlib.gzipSync(Buffer.from(makeTar(r.odb.files, r.odb.job))));
    const dir = path.join(out, nm); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
    let ok = true, msg = ''; try { cp.execFileSync('tar', ['xzf', tgz, '-C', dir]); const m = fs.readFileSync(path.join(dir, r.odb.job, 'matrix', 'matrix'), 'utf8'); ok = m.includes('STEP {') && fs.existsSync(path.join(dir, r.odb.job, 'steps', 'panel', 'layers', r.odb.layers[0], 'features')); msg = r.odb.files.size + '개 파일'; } catch (e) { ok = false; msg = String(e).slice(0, 120); }
    check(nm + '.tgz 풀기', ok, msg);
  }
  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
