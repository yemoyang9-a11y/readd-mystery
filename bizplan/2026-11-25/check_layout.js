const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto('file://' + process.argv[2]);
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => [...document.querySelectorAll('section.pg')].map((s, i) => {
    const ft = s.querySelector('.ft').getBoundingClientRect().top;
    let max = 0;
    s.querySelectorAll('.body *').forEach(e => { const q = e.getBoundingClientRect(); if (q.height > 0) max = Math.max(max, q.bottom); });
    return [i + 1, Math.round(max - ft)];
  }));
  console.log(JSON.stringify(r.slice(12)));
  const secs = await p.$$('section.pg');
  for (const i of [15]) await secs[i].screenshot({ path: process.argv[3] + '/p' + (i + 1) + '.png' });
  await b.close();
})();
