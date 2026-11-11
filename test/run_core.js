// 핵심 로직 검증: HTML에서 스크립트를 꺼내 Node에서 예제 도면을 변환해 본다.
// 사용: node test/run_core.js [-v]
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'DXF_to_Gerber.html'), 'utf8');
const m = /<script>([\s\S]*)<\/script>/.exec(html);
vm.runInThisContext(m[1], { filename: 'DXF_to_Gerber.js' });
const verbose = process.argv.includes('-v');

function cfgOf(extra) {
  return Object.assign({ layers: { L1_TOP: 'cu1', L2_BOT: 'cu2', SM_TOP: 'mask', '치수': 'none', '0': 'none' }, files: { cu1: 'ex_L1.gbr', cu2: 'ex_L2.gbr', mask: 'ex_SM.gbr' }, mirror: {}, origin: 'dxf', ratio: 4, grid: 0.002, thr: 0.005, apTol: 0.0001, noMacro: false, ellN: 48, allVoid: false, overrides: {}, voids: {} }, extra || {});
}
let fails = 0;
function check(name, cond, info) { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); }

(async () => {
  const dxfText = makeExampleDxf();
  const base = buildBase(parseDxf(dxfText), 'auto');
  console.log('도형', base.shapes.length, '무시', base.ignored.map(g => g.type).join(', '));
  const run = async (label, extra) => {
    const t = Date.now(), R = await convertAll(base, cfgOf(extra));
    console.log('\n== ' + label + ' (' + (Date.now() - t) + 'ms)');
    for (const L of R.layers) {
      console.log(L.label, JSON.stringify(L.stats), '최대 차이', L.verify.worst.toFixed(5), '초과', L.verify.nBad, '조리개', L.apertures.length);
      const g = {}; for (const w of L.warnings) (g[w.type] = g[w.type] || []).push(w);
      for (const k in g) console.log('   경고 ' + k + ' x' + g[k].length + (verbose || k === 'diff' || k === 'fallback' ? ': ' + g[k].map(w => '#' + w.id + ' ' + w.msg).join(' | ') : ''));
      if (verbose) for (const s of L.shapes) console.log('   #' + s.id, s.role, s.out || '', s.pad ? s.pad.type : 'poly' + s.pts.length, s.strokes ? 'st' + s.strokes.length + ' f' + s.fills.length : '', s.diff ? s.diff.maxDev.toFixed(5) : '', s.why || '');
    }
    return R;
  };
  const R = await run('기본');
  const L1 = R.layers.find(l => l.target === 'cu1'), L2 = R.layers.find(l => l.target === 'cu2'), SM = R.layers.find(l => l.target === 'mask');
  const at = (L, x, y) => L.shapes.filter(s => !s.dup && pip(s.flat, x, y)).sort((a, b) => a.area - b.area)[0];
  const exp = (L, name, x, y, role, nSt, nFill) => { const s = at(L, x, y); const ok = s && s.role === role && (nSt == null || (s.strokes && s.strokes.length === nSt)) && (nFill == null || (s.fills && s.fills.length === nFill)); check(name, ok, s ? '→ ' + s.role + (s.strokes ? ' 선' + s.strokes.length + ' 채움' + s.fills.length : '') + (s.why ? ' (' + s.why + ')' : '') : '객체 없음'); return s; };
  for (const L of R.layers) check(L.label + ' 형상 비교 기준 이내', L.verify.nBad === 0, '최대 ' + L.verify.worst.toFixed(5));
  exp(L1, '직선 배선', 7, 2, 'trace', 1, 0);
  exp(L1, '사각 패드', 2, 2, 'pad');
  exp(L1, '90도 꺾임', 5, 6, 'trace', 2, 1);
  exp(L1, '45도 두 번 꺾임', 16, 6, 'trace', 3, 2);
  exp(L1, 'T자 분기', 5, 14, 'trace', 3, 0);
  exp(L1, '계단 + 떠 있는 끝', 16, 14, 'trace', 2, 2);
  exp(L1, '테이퍼', 15.5, 17, 'trace', 2, 2);
  exp(L1, '떠 있는 끝', 4, 20, 'trace', 1, 1);
  exp(L1, '비스듬한 분기', 12, 20, 'trace', 3);
  exp(L1, 'CIRCLE 패드', 4.5, 24, 'pad');
  exp(L1, '폴리선 원', 6.5, 24, 'pad');
  exp(L1, '오블롱', 9, 24, 'pad');
  exp(L1, '세로 오블롱', 11, 24, 'pad');
  exp(L1, '둥근 모서리', 13.5, 24, 'pad');
  exp(L1, '타원', 16, 24, 'pad');
  exp(L1, '회전 사각', 18.5, 24, 'pad');
  exp(L1, '회전 오블롱', 21, 24, 'pad');
  exp(L1, '회전 둥근 모서리', 23.5, 24, 'pad');
  exp(L1, '짧은 배선 토막', 2.7, 31, 'trace', 1, 0);
  exp(L1, '좁은 패드에 닿는 배선', 10, 31, 'trace', 1, 1);
  exp(L1, '넓은 동박면', 21, 33, 'region');
  exp(L1, 'R12 POLYLINE 패드', 26, 2, 'pad');
  exp(L1, '블록 배선(그대로)', 3, 28, 'trace', 1, 0);
  exp(L1, '블록 배선(90도)', 7, 28, 'trace', 1, 0);
  exp(L1, '블록 배선(반전)', 11, 28, 'trace', 1, 0);
  exp(L1, '블록 배선(30도)', 15, 28, 'trace', 1, 0);
  exp(L1, '블록 배열 (2,2)', 22.5, 28.5, 'trace', 1, 0);
  exp(L2, '2층 세로 배선', 5, 9, 'trace', 1, 0);
  exp(L2, '2층 지그재그', 13, 9, 'trace', 4);
  exp(L2, '2층 T자', 6, 22, 'trace', 3, 0);
  exp(SM, '마스크 사각', 2, 2, 'pad');
  exp(SM, '마스크 불규칙', 17, 31, 'region');
  const types = t => L1.warnings.filter(w => w.type === t).length;
  check('좁은 패드 경고 1건', types('narrow') === 1, String(types('narrow')));
  check('겹침 경고 있음', types('overlap') >= 1, String(types('overlap')));
  check('안쪽 폴리선 경고 3건', types('nested') === 3, String(types('nested')));
  check('폭 있는 폴리선 경고 1건', types('width') === 1, String(types('width')));
  check('X2 속성 없음', !/%T[FAOD]/.test(L1.text) && !/%SR/.test(L1.text));
  check('형식 선언', L1.text.includes('%FSLAX46Y46*%') && L1.text.includes('%MOMM*%'));
  const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'example.dxf'), dxfText);
  for (const L of R.layers) fs.writeFileSync(path.join(out, L.file), L.text);
  fs.writeFileSync(path.join(out, 'example_gerber.zip'), makeZip(R.layers.map(L => ({ name: L.file, text: L.text }))));

  const R2 = await run('빈 곳 + 매크로 대신 영역 + 좌하단 원점 + 2층 반전', { allVoid: true, noMacro: true, origin: 'll', mirror: { cu2: true } });
  for (const L of R2.layers) check(L.label + ' 형상 비교 기준 이내', L.verify.nBad === 0, '최대 ' + L.verify.worst.toFixed(5));
  const L1b = R2.layers.find(l => l.target === 'cu1');
  check('LPC 출력', L1b.text.includes('%LPC*%'));
  check('매크로 없음', !L1b.text.includes('%AM'));
  check('원점 이동', Math.abs(R2.bbox[0]) < 1e-9 && Math.abs(R2.bbox[1]) < 1e-9);

  const R3 = await run('패드 → 배선 강제(사각 패드 #0)', { overrides: { [at(L1, 2, 2).id]: 'trace', [at(L1, 7, 2).id]: 'region' } });
  check('강제 변경 반영', at(R3.layers[0], 2, 2).role === 'trace' && at(R3.layers[0], 7, 2).role === 'region');
  for (const L of R3.layers) check(L.label + ' 형상 비교 기준 이내', L.verify.nBad === 0, '최대 ' + L.verify.worst.toFixed(5));

  // 일부러 틀린 결과를 넣었을 때 비교가 잡아내는지
  const bad = compareRegion([-0.5, 0, 3.5, 1],[mkPoly([[0, 0.4], [3, 0.4], [3, 0.6], [0, 0.6]])], [mkCap(0, 0.5, 3, 0.5, 0.1)], 0.002);
  check('비교가 둥근 끝 돌출을 잡음', bad.maxDev > 0.02, 'maxDev ' + bad.maxDev.toFixed(4));
  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
