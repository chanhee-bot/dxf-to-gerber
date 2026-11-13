// 핵심 로직 검증: HTML에서 스크립트를 꺼내 Node에서 예제 도면을 변환해 본다.
// 사용: node test/run_core.js [-v]
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', process.env.HTML || 'DXF_to_Gerber.html'), 'utf8');
const m = /<script>([\s\S]*)<\/script>/.exec(html);
vm.runInThisContext(m[1], { filename: 'DXF_to_Gerber.js' });
const verbose = process.argv.includes('-v');

function cfgOf(extra) {
  return Object.assign({ layers: { L1_TOP: 'cu1', L2_BOT: 'cu2', SM_TOP: 'mask', SM_BOT: 'mask2', OUTLINE: 'outline', '치수': 'none', '0': 'none' }, files: { cu1: 'ex_L1.gbr', cu2: 'ex_L2.gbr', mask: 'ex_SM1.gbr', mask2: 'ex_SM2.gbr', outline: 'ex_OUTLINE.gbr' }, mirror: {}, origin: 'dxf', ratio: 4, grid: 0.002, thr: 0.005, apTol: 0.0001, noMacro: false, ellN: 48, allVoid: false, overrides: {}, voids: {} }, extra || {});
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
  check('안쪽 폴리선 경고 5건', types('nested') === 5, String(types('nested')));
  // 배선과 한 외곽선으로 그린 패드
  { const a = exp(L1, '합쳐진 패드(위) → 패드', 25.2, 15.3, 'pad'), b = exp(L1, '합쳐진 패드(아래) → 패드', 25.2, 14.1, 'pad');
    check('  떼어 낸 패드 크기 0.4×0.6 플래시', [a, b].every(q => q && q.out === 'flash' && q.pad.type === 'R' && Math.abs(Math.min(q.pad.w, q.pad.h) - 0.4) < 1e-6 && Math.abs(Math.max(q.pad.w, q.pad.h) - 0.6) < 1e-6), [a, b].map(q => q && q.pad ? q.pad.type + ' ' + q.pad.w.toFixed(3) + '×' + q.pad.h.toFixed(3) + ' ' + q.out : '-').join(', '));
    exp(L1, '패드 사이 목 → 선', 25.2, 14.7, 'trace', 1); exp(L1, '패드로 들어오는 배선 → 선', 24.3, 15.3, 'trace', 1);
    check('패드 떼어냄 표시 2건', types('padcut') === 2, String(types('padcut'))); }
  // 동박 글자(내장 획 글꼴)·열린 선
  { const tp = L1.prims.filter(p => p.sub === 'text'), ub = (x0, y0, x1, y1) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of tp) { const q = p.bbox; if (q[0] < x0 || q[2] > x1 || q[1] < y0 || q[3] > y1) continue; b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); } return b; };
    const near = (b, e) => b.every((v, i) => Math.abs(v - e[i]) < 0.02), f = b => b.map(v => v.toFixed(3)).join(',');
    check('글자 2개 + 열린 선 2개를 선으로', L1.stats.texts === 2 && L1.stats.opens === 2 && types('text') === 2 && types('open') === 2 && L1.text.includes('G04 TEXT*'), JSON.stringify({ t: L1.stats.texts, o: L1.stats.opens }));
    const s8 = 0.8 / 6, w8 = 0.08, t1 = ub(1.5, 32.5, 10, 34.5); check('TEXT 위치·크기(왼쪽 기준선, 높이 0.8, 선폭 10%)', near(t1, [2 - w8 / 2, 33.2 - w8 / 2, 2 + 52 * s8 + w8 / 2, 34 + w8 / 2]), f(t1));
    const s5 = 0.5 / 6, T = 0.5 * 5 / 3 + 0.5, W = 10 * s5, t2 = ub(26, 9.5, 28.5, 11.5); check('MTEXT 2줄·가운데 맞춤·90도', near(t2, [27.3 - T / 2 - 0.025, 10.5 - W / 2 - 0.025, 27.3 + T / 2 + 0.025, 10.5 + W / 2 + 0.025]), f(t2)); }
  // 외형, 솔더마스크 2
  { const OL = R.layers.find(l => l.target === 'outline'), M2L = R.layers.find(l => l.target === 'mask2');
    check('출력 5개(동박 1·2, 솔더마스크 1·2, 외형)', R.layers.map(l => l.target).join(',') === 'cu1,cu2,mask,mask2,outline', R.layers.map(l => l.target).join(','));
    check('외형: 선·호 8개를 이은 닫힌 외곽선 1 + 따로 떨어진 선 1', OL && OL.stats.outlines === 1 && OL.stats.paths === 1, OL ? JSON.stringify(OL.stats) : '없음');
    check('외형: 호는 G03, 선폭 0.1', OL && /G03\*/.test(OL.text) && OL.text.includes('%ADD10C,0.1*%') && !OL.text.includes('G36'), '');
    check('외형 검사 기준 이내', OL && OL.verify.nBad === 0, OL ? '최대 ' + OL.verify.worst.toFixed(5) : '');
    check('솔더마스크 2: 개구부 4개', M2L && M2L.stats.pads === 4 && M2L.verify.nBad === 0, M2L ? JSON.stringify(M2L.stats) : '없음'); }
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
  { const o = R2.offset, lv = (x, y) => { const q = at(L1b, x - o[0], y - o[1]); return q ? q.level : -1; };
    const a = [lv(26.7, 6), lv(26.2, 6), lv(25.5, 6)], b = [lv(21, 31), lv(19.6, 32), lv(19, 32), lv(17.5, 30.75)];
    check('번갈아: 3겹 사각 = 동박·빈 곳·동박', a.join() === '0,1,2', a.join());
    check('번갈아: 동박면·구멍·섬 = 0·1·2, 구멍(사각) = 1', b.join() === '0,1,2,1', b.join());
    check('빈 곳 안의 섬은 다시 동박(%LPD 뒤에 다시 %LPD)', /%LPC\*%[\s\S]*%LPD\*%/.test(L1b.text)); }
  check('매크로 없음', !L1b.text.includes('%AM'));
  check('원점 이동', Math.abs(R2.bbox[0]) < 1e-9 && Math.abs(R2.bbox[1]) < 1e-9);

  const R3 = await run('패드 → 배선 강제(사각 패드 #0)', { overrides: { [at(L1, 2, 2).id]: 'trace', [at(L1, 7, 2).id]: 'region' } });
  check('강제 변경 반영', at(R3.layers[0], 2, 2).role === 'trace' && at(R3.layers[0], 7, 2).role === 'region');
  for (const L of R3.layers) check(L.label + ' 형상 비교 기준 이내', L.verify.nBad === 0, '최대 ' + L.verify.worst.toFixed(5));

  // 층별 재사용: 직전 결과를 주면 입력이 같은 층은 그대로 쓴다
  { const c0 = cfgOf(), Ra = await convertAll(base, c0), Rb = await convertAll(base, cfgOf({ layers: Object.assign({}, c0.layers, { SM_BOT: 'none' }) }), null, Ra);
    const same = t => Ra.layers.find(l => l.target === t) === Rb.layers.find(l => l.target === t);
    check('솔더마스크 2만 뺐을 때 나머지 층은 그대로', same('cu1') && same('cu2') && same('mask') && same('outline') && !Rb.layers.find(l => l.target === 'mask2'));
    const idp = at(Ra.layers[0], 2, 2).id, Rc = await convertAll(base, cfgOf({ overrides: { [idp]: 'trace' } }), null, Ra), sc = t => Ra.layers.find(l => l.target === t) === Rc.layers.find(l => l.target === t);
    check('동박 1의 객체를 바꾸면 동박 1만, 그것도 바뀐 객체 주변만 다시', Rc.layers[0].partial && Rc.layers[0].partial.changed === 1 && Rc.layers[0].partial.compared < 10 && !Rc.layers[0].reused && sc('cu2') && sc('mask') && sc('mask2') && sc('outline') && at(Rc.layers[0], 2, 2).role === 'trace', JSON.stringify(Rc.layers[0].partial));
    const Rd = await convertAll(base, cfgOf({ ratio: 3 }), null, Ra); check('패드 판정 비율을 바꾸면 외형만 빼고 다시 변환', Rd.layers.map(l => l.target + (l.reused ? '=' : '!')).join(' ') === 'cu1! cu2! mask! mask2! outline=', Rd.layers.map(l => l.target + (l.reused ? '=' : '!')).join(' '));
    const pid = L1.shapes.find(q => q.padCut).id, pid2 = (await convertAll(base, cfgOf({ layers: Object.assign({}, c0.layers, { L2_BOT: 'none' }) }))).layers[0].shapes.find(q => q.padCut).id;
    check('다른 층을 빼도 토막 번호는 그대로', pid === pid2, pid + ' ' + pid2); }
  // 부분 다시 변환 = 처음부터 변환: 눌러 바꾼 것을 차례로 쌓아 가며, 매번 처음부터 한 결과와 같은지
  { const strip = t => t.replace(/G04 DXF_to_Gerber build [^*]*\*/, ''), R0 = await convertAll(base, cfgOf()), L0 = R0.layers[0], idAt = (x, y) => at(L0, x, y).id;
    const steps = [['패드 → 배선', { overrides: { [idAt(2, 2)]: 'trace' } }], ['배선 → 영역 추가', { overrides: { [idAt(2, 2)]: 'trace', [idAt(5, 6)]: 'region' } }], ['패드 → 배선 되돌림 + 배선 → 패드 불가(무시)', { overrides: { [idAt(5, 6)]: 'region', [idAt(16, 6)]: 'pad' } }],
      ['안쪽 원을 빈 곳으로', { overrides: { [idAt(5, 6)]: 'region' }, voids: { [idAt(19.6, 32)]: true } }], ['그 안의 섬은 동박, 사각 구멍도 빈 곳', { overrides: {}, voids: { [idAt(19.6, 32)]: true, [idAt(19, 32)]: false, [idAt(17.5, 30.75)]: true } }], ['모두 되돌림', {}]];
    let cur = R0, allOk = true, info = '';
    for (const [nm, extra] of steps) {
      cur = await convertAll(base, cfgOf(extra), null, cur); const full = await convertAll(base, cfgOf(extra));
      const sig = L => L.shapes.map(q => q.id + ':' + q.role + ':' + q.level + ':' + (q.isVoid ? 1 : 0) + ':' + (q.diff ? q.diff.maxDev.toFixed(9) : '-') + ':' + (q.why || '')).join('|'), wsig = L => L.warnings.map(w => w.type + ':' + w.id + ':' + w.msg).sort().join('|');
      const ok = cur.layers.every((l, i) => strip(l.text) === strip(full.layers[i].text) && sig(l) === sig(full.layers[i]) && wsig(l) === wsig(full.layers[i]) && l.verify.nBad === full.layers[i].verify.nBad && Math.abs(l.verify.worst - full.layers[i].verify.worst) < 1e-12);
      const part = cur.layers[0].partial; if (!ok || !part) { allOk = false; info += ' [' + nm + ': ' + (ok ? '부분 변환 아님' : '다름') + ']'; } else info += ' ' + part.changed + '/' + part.compared;
    }
    check('부분 다시 변환 = 처음부터 변환 (6단계: Gerber·판정·비교 값·경고 모두 같음)', allOk, '바뀐/비교 객체 수:' + info); }
  // 여러 코어 경로: 워커가 하는 일(workerHandle)을 복제된 값으로 불러, 한 코어 결과와 같은지
  { let calls = 0; const fake = { n: 3, force: true, run: async (count, make, onP) => { const out = []; for (let k = 0; k < count; k++) { out.push(structuredClone(workerHandle(structuredClone(make(k))))); calls++; if (onP) onP(k + 1, count); } return out; } };
    for (const [nm, extra] of [['기본', {}], ['번갈아·매크로 대신 영역·반전', { allVoid: true, noMacro: true, origin: 'll', mirror: { cu2: true } }]]) {
      const A = await convertAll(base, cfgOf(extra)), B = await convertAll(base, cfgOf(extra), null, null, fake);
      const strip = t => t.replace(/G04 DXF_to_Gerber build [^*]*\*/, '');
      check('여러 코어 = 한 코어 (' + nm + '): Gerber 글자 그대로', A.layers.length === B.layers.length && A.layers.every((l, i) => strip(l.text) === strip(B.layers[i].text)));
      const dv = L => L.shapes.map(q => q.id + ':' + (q.diff ? q.diff.maxDev.toFixed(9) : '-') + ':' + q.role).join(' ');
      check('  형상 비교 값·판정도 같음', A.layers.every((l, i) => dv(l) === dv(B.layers[i]) && l.verify.nBad === B.layers[i].verify.nBad && Math.abs(l.verify.worst - B.layers[i].verify.worst) < 1e-12));
    }
    check('워커 일을 실제로 거침', calls > 4, String(calls)); }
  // 일부러 틀린 결과를 넣었을 때 비교가 잡아내는지
  const bad = compareRegion([-0.5, 0, 3.5, 1],[mkPoly([[0, 0.4], [3, 0.4], [3, 0.6], [0, 0.6]])], [mkCap(0, 0.5, 3, 0.5, 0.1)], 0.002);
  check('비교가 둥근 끝 돌출을 잡음', bad.maxDev > 0.02, 'maxDev ' + bad.maxDev.toFixed(4));

  // ---- 꺾임 R이 있는 배선 · 잘린(열린) 외곽선 잇기 · 큰 외곽선 토막 · 호 4개짜리 원 ----
  {
    const o = []; const w = (c, v) => o.push(String(c), String(v));
    const B = Math.tan(Math.PI / 8); // 90° 호의 bulge
    const pl = (layer, pts, closed) => { w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(70, closed ? 1 : 0); for (const p of pts) { w(0, 'VERTEX'); w(8, layer); w(10, p[0]); w(20, p[1]); if (p[2]) w(42, p[2]); } w(0, 'SEQEND'); };
    w(0, 'SECTION'); w(2, 'ENTITIES');
    // (1) 폭 0.2 ㄱ자 배선, 안팎 모서리 R0.05, 양 끝 패드
    const L1 = [[1, 0.9], [4.05, 0.9], [4.1, 0.95, B], [4.1, 4], [3.9, 4], [3.9, 1.15], [3.85, 1.1, -B], [1, 1.1]];
    L1[1][2] = B; L1[2][2] = 0; L1[5][2] = -B; L1[6][2] = 0;
    pl('CU', L1, true);
    pl('CU', [[0.4, 0.7], [1, 0.7], [1, 1.3], [0.4, 1.3]], true); pl('CU', [[3.7, 4], [4.3, 4], [4.3, 4.6], [3.7, 4.6]], true);
    // (2) 같은 모양을 x+6 옮겨 두 토막의 열린 선으로(방향도 서로 반대)
    const M = L1.map(p => [p[0] + 6, p[1], p[2] || 0]);
    pl('CU', [M[7], M[0], M[1], M[2], M[3]], false);
    const back = [M[3], M[4], M[5], M[6], M[7]], rev = back.map((p, i) => [back[back.length - 1 - i][0], back[back.length - 1 - i][1], i < back.length - 1 ? -(back[back.length - 2 - i][2] || 0) : 0]);
    pl('CU', rev, false);
    pl('CU', [[6.4, 0.7], [7, 0.7], [7, 1.3], [6.4, 1.3]], true); pl('CU', [[9.7, 4], [10.3, 4], [10.3, 4.6], [9.7, 4.6]], true);
    // (3) 긴 빗 모양 레일: 세로 줄기(폭 0.3) + 가지 60개(폭 0.16, 모서리 R0.05)
    const comb = [[20, 0], [20.3, 0]];
    for (let k = 0; k < 60; k++) { const y = 1 + k * 2; comb.push([20.3, y - 0.05, B], [20.35, y], [21.5, y], [21.5, y + 0.16], [20.35, y + 0.16, B], [20.3, y + 0.21]); }
    comb.push([20.3, 122], [20, 122]);
    pl('CU', comb, true);
    // (4) 호 4개로 그린 원(bulge를 소수 5자리로 반올림)
    pl('CU', [[15.5, 2, 0.41421], [15, 2.5, 0.41421], [14.5, 2, 0.41421], [15, 1.5, 0.41421]], true);
    w(0, 'ENDSEC'); w(0, 'EOF');
    const base2 = buildBase(parseDxf(o.join('\n')), 'auto');
    check('열린 선 2개를 이어 닫힌 외곽선 1개', base2.joined.loops === 1 && base2.joined.parts === 2, JSON.stringify(base2.joined));
    const R5 = await convertAll(base2, cfgOf({ layers: { CU: 'cu1' } })), L5 = R5.layers[0];
    console.log('\n== 꺾임 R · 잇기 · 토막', JSON.stringify(L5.stats), '최대 차이', L5.verify.worst.toFixed(5), '초과', L5.verify.nBad, '나눈 도형', L5.split);
    const a1 = at(L5, 2.5, 1), a2 = at(L5, 8.5, 1), ci = at(L5, 15, 2), parts = L5.shapes.filter(s => s.partOf != null);
    check('꺾임 R 배선 → 선', a1 && a1.role === 'trace' && a1.strokes.length === 2, a1 ? a1.role + ' 선' + (a1.strokes ? a1.strokes.length : 0) + ' ' + (a1.why || '') : '없음');
    check('이은 외곽선 → 선', a2 && a2.role === 'trace' && a2.strokes.length === 2, a2 ? a2.role + ' ' + (a2.why || '') : '없음');
    check('큰 외곽선을 토막으로 나눔', L5.split === 1 && parts.length >= 2, parts.length + '토막');
    check('토막이 모두 선으로', parts.every(s => s.role === 'trace' && s.strokes), parts.filter(s => s.role !== 'trace').map(s => s.why).join(' | '));
    check('호 4개 원 → 원 패드', ci && ci.role === 'pad' && ci.pad.type === 'C' && Math.abs(ci.pad.d - 1) < 1e-4, ci ? ci.role + ' ' + (ci.pad ? ci.pad.type + ' ' + ci.pad.d : '') : '없음');
    check('형상 비교 기준 이내', L5.verify.nBad === 0, '최대 ' + L5.verify.worst.toFixed(5));
    check('영역 대체 없음', L5.stats.areas === 0, L5.warnings.filter(q => q.type === 'fallback').map(q => q.msg).join(' | '));
  }
  { // 같은 자리 같은 요소: 서로 다른 도형이 똑같은 플래시·선·채움·영역을 내면 하나만 출력
    console.log('\n== 같은 자리 같은 요소');
    const b9 = buildBase(parseDxf(makeExampleDxf()), 'auto', false), c9 = { layers: { L1_TOP: 'cu1' }, files: {}, mirror: {}, origin: 'dxf', ratio: 4, grid: 0.002, thr: 0.005, apTol: 0.0001, noMacro: false, ellN: 48, allVoid: false, padCut: true, overrides: {}, voids: {} };
    const R9 = await convertAll(b9, c9), L9 = R9.layers[0], n0 = L9.prims.length;
    check('예제 도면에는 없음', L9.stats.same === 0, '제거 ' + L9.stats.same);
    const pick = r => L9.shapes.find(s => !s.dup && s.role === r && (r !== 'trace' || (s.strokes && s.fills.length)));
    const add = [pick('pad'), pick('trace'), pick('region')].map((s, i) => Object.assign(Object.create(Object.getPrototypeOf(s)), s, { id: 900000 + i }));
    const want = 2 + add[1].strokes.length + add[1].fills.length; L9.shapes.push(...add);
    const g9 = buildGerber(L9, c9), p9 = parseGerber(g9.text);
    check('복사한 도형 3개의 요소를 모두 뺌', g9.stats.same === want && g9.stats.sameFlash === 1 && g9.stats.sameLine === add[1].strokes.length && p9.length === n0, '제거 ' + g9.stats.same + ' (기대 ' + want + '), Gerber 요소 ' + n0 + ' → ' + p9.length);
    check('경고 목록에 표시', L9.warnings.filter(q => q.type === 'same').length === want);
    L9.prims = p9; const o9 = buildOdb(R9, b9, { job: 't', units: 'mm', steps: false, apTol: 1e-4, ellN: 48 }), k9 = checkOdb(o9, R9);
    check('ODB++도 같은 요소를 빼고 대조 일치', k9.ok, '요소 ' + k9.total + ' 빠짐 ' + k9.miss + ' 남음 ' + k9.extra);
  }
  { // 트루타입 글꼴: 글자 윤곽을 그대로 영역으로(안쪽 윤곽은 빈 곳)
    console.log('\n== 트루타입 글꼴로 글자 내기');
    const fp = ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf'].find(p => fs.existsSync(p));
    if (!fp) console.log('  (시험할 글꼴 파일이 없어 건너뜀)');
    else {
      const font = parseTtf(new Uint8Array(fs.readFileSync(fp))), o = [], w = (c, v) => o.push(String(c), String(v));
      check('글꼴 읽기', font.cap > 0 && font.upm >= 1000 && font.gid(65) > 0, font.name + ' 칸 ' + font.upm + ' 대문자 높이 ' + font.cap);
      const one = fontLine('H', font, 0.001), ys = one.outl[0].pts.map(q => q[1]);
      check('H의 높이 = 글자 높이(6칸)', one.outl.length === 1 && Math.abs(Math.max(...ys) - 6) < 0.02 && Math.abs(Math.min(...ys)) < 0.02, Math.min(...ys).toFixed(3) + '~' + Math.max(...ys).toFixed(3));
      const B8 = fontLine('B8O', font, 0.001); check('B·8·O의 안쪽 윤곽은 빈 곳', B8.outl.length === 8 && B8.outl.filter(q => q.hole).length === 5, '윤곽 ' + B8.outl.length + ' 빈 곳 ' + B8.outl.filter(q => q.hole).length);
      w(0, 'SECTION'); w(2, 'ENTITIES');
      w(0, 'TEXT'); w(8, 'CU'); w(10, 10); w(20, 20); w(40, 2); w(1, 'LED-08 Rev.B');
      w(0, 'TEXT'); w(8, 'CU'); w(10, 10); w(20, 30); w(40, 3); w(50, 90); w(1, 'HO');
      w(0, 'MTEXT'); w(8, 'CU'); w(10, 30); w(20, 40); w(40, 1.5); w(71, 1); w(1, 'AB\\PCD 80%');
      w(0, 'POLYLINE'); w(8, 'CU'); w(66, 1); w(70, 1); for (const p of [[40, 20], [42, 20], [42, 21], [40, 21]]) { w(0, 'VERTEX'); w(8, 'CU'); w(10, p[0]); w(20, p[1]); } w(0, 'SEQEND');
      w(0, 'ENDSEC'); w(0, 'EOF');
      const dxf = parseDxf(o.join('\n')), bF = buildBase(dxf, 'auto', false, font), b0 = buildBase(dxf, 'auto', false);
      const cF = { layers: { CU: 'cu1' }, files: {}, mirror: {}, origin: 'dxf', ratio: 4, grid: 0.002, thr: 0.005, apTol: 0.0001, noMacro: false, ellN: 48, allVoid: false, padCut: true, textOn: true, textPct: 10, overrides: {}, voids: {} };
      check('글꼴 없으면 예전처럼 획(선)', b0.texts.length === 3 && b0.shapes.length === 1 && b0.gtexts.length === 0);
      check('글꼴 있으면 글자가 닫힌 도형', bF.texts.length === 0 && bF.gtexts.length === 3 && bF.shapes.filter(s => s.glyph).length > 20, '글자 도형 ' + bF.shapes.filter(s => s.glyph).length + ' (빈 곳 ' + bF.shapes.filter(s => s.gv).length + ')');
      const hs = bF.shapes.filter(s => s.glyph && !s.gv), H1 = hs.find(s => Math.abs(s.bbox[0] - 10) < 0.6 && s.bbox[1] > 19.9 && s.bbox[3] < 22.1);
      check('첫 글자 L: 기준점 (10, 20), 높이 2mm', !!H1 && Math.abs(H1.bbox[1] - 20) < 0.01 && Math.abs(H1.bbox[3] - 22) < 0.01, H1 ? H1.bbox.map(v => v.toFixed(3)).join(' ') : '없음');
      const RF = await convertAll(bF, cF), LF = RF.layers[0], gs = LF.shapes.filter(s => s.glyph);
      check('글자 윤곽은 모두 영역, 안쪽은 빈 곳(LPC)', gs.every(s => s.role === 'region') && gs.filter(s => s.gv).every(s => s.isVoid && s.level === 1) && gs.filter(s => !s.gv).every(s => !s.isVoid && s.level === 0) && /%LPC\*%/.test(LF.text), '영역 ' + gs.length + ' 빈 곳 ' + gs.filter(s => s.isVoid).length);
      check('사각 패드는 그대로 플래시', LF.shapes.some(s => !s.glyph && s.role === 'pad'));
      check('형상 비교 기준 이내', LF.verify.nBad === 0, '최대 ' + LF.verify.worst.toFixed(5));
      check('경고 목록: 글꼴 윤곽으로 냄 3건, 안쪽 폴리선 경고 없음', LF.warnings.filter(q => q.type === 'gtext').length === 3 && LF.warnings.filter(q => q.type === 'nested').length === 0, LF.warnings.map(q => q.type).join(','));
      const R0 = await convertAll(bF, Object.assign({}, cF, { textOn: false })); check('"글자 내기"를 끄면 글자 도형을 뺌', R0.layers[0].shapes.every(s => !s.glyph) && R0.layers[0].shapes.length === 1);
      const od = buildOdb(RF, bF, { job: 't', units: 'mm', steps: false, apTol: 1e-4, ellN: 48 }), kc = checkOdb(od, RF);
      check('ODB++ 대조 일치(빈 곳은 음극성)', kc.ok && / N 0/.test(od.files.get('steps/panel/layers/l1/features')), '요소 ' + kc.total + ' 빠짐 ' + kc.miss + ' 남음 ' + kc.extra);
      const RM = await convertAll(bF, Object.assign({}, cF, { mirror: { cu1: true }, origin: 'll' })); check('좌우 반전·원점 이동에서도 기준 이내', RM.layers[0].verify.nBad === 0 && RM.layers[0].shapes.filter(s => s.glyph).length === gs.length, '최대 ' + RM.layers[0].verify.worst.toFixed(5));
    }
  }
  { // 레일에서 LED 패드로 가는 짧은 목(R이 커서 직선 부분이 짧음): 영역이 아니라 선으로, 레일은 끊기지 않게, 목 선은 패드 안으로
    console.log('\n== 레일–패드 사이 짧은 목');
    const mkNeck = (R, nh, nl) => { const o = [], w = (c, v) => o.push(String(c), String(v)), B = Math.tan(Math.PI / 8), pts = [[0, 0], [0.5, 0]], N = 5, P = 4;
      for (let i = 0; i < N; i++) { const yc = i * P + 2, y0 = yc - nh / 2, y1 = yc + nh / 2, xr = 0.5, xp = 0.5 + nl; pts.push([xr, y0 - R, B], [xr + R, y0], [xp - R, y0, B], [xp, y0 - R], [xp, yc - 0.7], [xp + 0.95, yc - 0.7], [xp + 0.95, yc + 0.7], [xp, yc + 0.7], [xp, y1 + R, B], [xp - R, y1], [xr + R, y1, B], [xr, y1 + R]); }
      pts.push([0.5, N * P], [0, N * P]); w(0, 'SECTION'); w(2, 'ENTITIES'); w(0, 'POLYLINE'); w(8, 'CU'); w(66, 1); w(70, 1); for (const p of pts) { w(0, 'VERTEX'); w(8, 'CU'); w(10, p[0]); w(20, p[1]); if (p[2]) w(42, p[2]); } w(0, 'SEQEND'); w(0, 'ENDSEC'); w(0, 'EOF'); return o.join('\n'); };
    for (const [R, nh, nl] of [[0.1, 0.55, 0.45], [0.2, 0.55, 0.45], [0.05, 0.3, 0.8]]) {
      const bN = buildBase(parseDxf(mkNeck(R, nh, nl)), 'auto'), RN = await convertAll(bN, { layers: { CU: 'cu1' }, files: {}, mirror: {}, origin: 'dxf', ratio: 4, grid: 0.002, thr: 0.005, apTol: 0.0001, noMacro: false, ellN: 48, allVoid: false, padCut: true, overrides: {}, voids: {} });
      const LN = RN.layers[0], st = LN.shapes.filter(s => s.role === 'trace').flatMap(s => s.strokes || []);
      const rail = st.filter(k => Math.abs(k.x1 - 0.25) < 1e-6 && Math.abs(k.x2 - 0.25) < 1e-6).map(k => [Math.min(k.y1, k.y2), Math.max(k.y1, k.y2)]).sort((a, b) => a[0] - b[0]);
      let gaps = 0; for (let i = 1; i < rail.length; i++) if (rail[i][0] > rail[i - 1][1] + 1e-6) gaps++;
      const neck = st.filter(k => Math.abs(k.y1 - k.y2) < 1e-6), padX = 0.5 + nl;
      const okNeck = neck.length === 5 && neck.every(k => Math.abs(k.w - nh) < 1e-6 && Math.min(k.x1, k.x2) <= 0.5 - 1e-6 && Math.abs(Math.max(k.x1, k.x2) - (padX + nh / 2)) < 1e-6);
      check('R ' + R + ', 목 ' + nh + '×' + nl + ': 레일 이어짐·목은 선·패드 안으로 w/2', LN.stats.pads === 5 && gaps === 0 && okNeck && LN.stats.areas === 0 && LN.verify.nBad === 0, '레일 선 ' + rail.length + ' 끊긴 곳 ' + gaps + ' 목 선 ' + neck.length + (neck[0] ? ' (x ' + Math.min(neck[0].x1, neck[0].x2).toFixed(3) + '~' + Math.max(neck[0].x1, neck[0].x2).toFixed(3) + ')' : '') + ' 최대 ' + LN.verify.worst.toFixed(4));
    }
  }
  console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
