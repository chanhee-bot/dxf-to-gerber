// 트루타입 글꼴 불러오기를 브라우저(Chromium)에서 확인: 글꼴 파일 열기 → 예제 도면 변환 → 글자가 윤곽(영역)으로 나오는지, 다시 열어도 글꼴이 기억되는지.
// 사용: node test/run_font_browser.js [글꼴.ttf]   (없으면 Liberation Sans Bold / Arial Bold를 찾는다)
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const root = path.join(__dirname, '..'), shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
let fails = 0; const check = (name, cond, info) => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  ' + info : '')); };
const fp = process.argv[2] || ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf'].find(p => fs.existsSync(p));
(async () => {
  if (!fp) { console.log('시험할 글꼴 파일이 없어 건너뜀'); process.exit(0); }
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1680, height: 950 }, deviceScaleFactor: 2 }), page = await ctx.newPage();
  const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  const url = 'file:///' + path.join(root, 'DXF_to_Gerber.html').replace(/\\/g, '/');
  const done = () => page.waitForFunction(() => { const b = document.getElementById('btnConvert'); return b && !b.disabled && !/중|…/.test(b.textContent); }, null, { timeout: 120000 }).catch(() => {});
  await page.goto(url); await page.check('#oAuto');
  check('처음에는 글꼴 없음 안내', (await page.textContent('#fontMsg')).includes('글꼴 없음'));
  await page.click('#btnExample'); await page.waitForTimeout(1500); await done();
  const st0 = await page.evaluate(() => { const L = window.__S ? null : null; return document.getElementById('warnBox') ? document.getElementById('warnBox').textContent : ''; });
  const zoomText = async name => { // 예제 도면의 글자 자리(TEXT "LED-01 R2")로 확대해 찍는다
    await page.evaluate(() => { const it = [...document.querySelectorAll('#warnBox .witem, #warnBox li, #warnBox div')].find(e => /LED-01/.test(e.textContent) && e.children.length <= 3); if (it) it.click(); });
    await page.waitForTimeout(700); await page.screenshot({ path: path.join(shots, name) });
  };
  await zoomText('font_0_stroke.png');
  await page.setInputFiles('#fontFile', fp); await page.waitForTimeout(1500); await done(); await page.waitForTimeout(500);
  const msg = await page.textContent('#fontMsg');
  check('글꼴을 열면 이름 표시', /쓰는 글꼴/.test(msg) && !/읽지 못했/.test(msg), msg.slice(0, 80));
  const w = await page.textContent('#warnBox');
  check('경고 목록에 "불러온 글꼴 윤곽으로 냄"', /불러온 글꼴 윤곽으로 냄/.test(w) && !/내장 글꼴로 근사/.test(w));
  check('형상 비교 통과', /모든 객체가 기준 이내/.test(await page.textContent('body')));
  await zoomText('font_1_outline.png');
  await page.reload(); await page.waitForTimeout(500);
  check('다시 열어도 글꼴이 기억됨', /쓰는 글꼴/.test(await page.textContent('#fontMsg')), (await page.textContent('#fontMsg')).slice(0, 60));
  await page.click('#btnFontClr'); check('글꼴 지움', (await page.textContent('#fontMsg')).includes('글꼴 없음'));
  check('콘솔 오류 없음', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close(); console.log(fails ? '\n실패 ' + fails + '건' : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
