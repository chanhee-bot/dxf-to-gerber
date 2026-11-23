// 여러 시험 도면을 화면 기본 설정(번갈아 켬)으로 변환해 예외가 나는지 본다.
// 사용: node test/run_many.js a.dxf b.dxf ...
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'DXF_to_Gerber.html'), 'utf8');
vm.runInThisContext(/<script>([\s\S]*)<\/script>/.exec(html)[1], { filename: 'DXF_to_Gerber.js' });
(async () => {
  let bad = 0;
  for (const f of process.argv.slice(2)) for (const cut of [false, true]) for (const tg of ['cu1', 'mask']) {
    try {
      const base = buildBase(parseDxf(fs.readFileSync(f, 'latin1')), 'auto', cut);
      const layers = {}; for (const s of base.shapes) layers[s.layer] = tg; for (const t of base.texts || []) layers[t.layer] = tg;
      const cfg = { layers, files: {}, mirror: {}, origin: 'll', ratio: 4, grid: 0.002, thr: 0.005, apTol: 0.0001, noMacro: false, ellN: 5, allVoid: true, overrides: {}, voids: {}, padCut: true, openLine: true, openW: 0.1, text: true, textPct: 10, outW: 0.1 };
      const R = await convertAll(base, cfg);
      console.log('ok  ', path.basename(f), cut, tg, base.shapes.length, R.layers.map(l => l.verify.nBad).join(','));
    } catch (e) { bad++; console.log('FAIL', path.basename(f), cut, tg, e.stack.split('\n').slice(0, 6).join('\n   ')); }
  }
  process.exit(bad ? 1 : 0);
})();
