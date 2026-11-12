const { chromium } = require('playwright');
(async () => {
  const [,, url, prefix, w, h, steps] = process.argv;
  const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: +w<800, isMobile: +w<800 });
  const logs=[]; p.on('console', m => logs.push(m.type()+': '+m.text())); p.on('pageerror', e => logs.push('ERR '+e.message));
  await p.goto(url+'?nospin');
  await p.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  await p.waitForTimeout(1500);
  for (const [i, st] of steps.split('|').entries()) {
    const [name, js] = st.split('=>');
    if (js) await p.evaluate(js);
    await p.waitForTimeout(2600);
    await p.screenshot({ path: `${prefix}${name}.png`, timeout: 120000 });
  }
  console.log(logs.slice(0,30).join('\n'));
  await b.close();
})();
