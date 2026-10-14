const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
document.getElementById('toMenu').click();
await sleep(200);
for (const m of ['jump', 'catch', 'fire', 'shop', 'mine', 'pet']) {
  document.querySelector('.card[data-mode="' + m + '"]').click();
  await sleep(450);
  const entered = scene;
  const visible = !!document.getElementById('btnBack').offsetParent;
  document.getElementById('btnBack').click();
  await sleep(300);
  out.push(m + ' 进入=' + entered + ' 按钮可见=' + visible + ' 点完=' + scene);
}
return out;
