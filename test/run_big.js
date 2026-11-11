// 큰 도면 속도 측정: 예제 도면 전체를 블록으로 묶어 n×n 배열 INSERT로 펼친다.
// 사용: node test/run_big.js [n]   (기본 10 → 도형 8700개). test/out/big_n.dxf도 만든다(브라우저에서 열어 볼 수 있음).
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', process.env.HTML || 'DXF_to_Gerber.html'), 'utf8');
vm.runInThisContext(/<script>([\s\S]*)<\/script>/.exec(html)[1], { filename: 'DXF_to_Gerber.js' });
const n = +process.argv[2] || 10;
const t = makeExampleDxf(), nl = t.includes('\r\n') ? '\r\n' : '\n';
const s = t.indexOf(nl, t.indexOf('ENTITIES')) + nl.length;
const lines = t.slice(s).split(nl), ents = lines.slice(0, lines.indexOf('ENDSEC') - 1).join(nl);
const blk = ['0', 'BLOCK', '8', '0', '2', 'ALL', '70', '0', '10', '0', '20', '0', '30', '0', '3', 'ALL'].join(nl) + nl + ents + nl + ['0', 'ENDBLK', '8', '0'].join(nl);
const be = t.indexOf(nl + 'ENDSEC', t.indexOf('BLOCKS'));
const dxf = t.slice(0, be).replace(/\s*0\s*$/, '') + nl + blk + nl + '0' + t.slice(be, s)
  + ['0', 'INSERT', '8', '0', '2', 'ALL', '10', '0', '20', '0', '70', n, '71', n, '44', '40', '45', '40', '0', 'ENDSEC', '0', 'EOF'].join(nl) + nl;
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'big_' + n + '.dxf'), dxf);
(async () => {
  const t0 = Date.now(), base = buildBase(parseDxf(dxf), 'auto'), t1 = Date.now();
  const cfg = { layers: { L1_TOP: 'cu1', L2_BOT: 'cu2', SM_TOP: 'mask' }, files: { cu1: 'a', cu2: 'b', mask: 'c' }, mirror: {}, origin: 'dxf', ratio: 4, grid: 0.002, thr: 0.005, apTol: 0.0001, noMacro: false, ellN: 48, allVoid: false, overrides: {}, voids: {} };
  const R = await convertAll(base, cfg), t2 = Date.now();
  console.log('도형', base.shapes.length, '읽기', t1 - t0, 'ms 변환', t2 - t1, 'ms 기준 초과', R.layers.map(l => l.verify.nBad).join('/'));
})();
