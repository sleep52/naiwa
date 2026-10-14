const sleep = ms => new Promise(r => setTimeout(r, ms));
document.getElementById('toMenu').click();
await sleep(200);
document.querySelector('.card[data-mode="jump"]').click();
await sleep(700);
const b = document.getElementById('btnBack');
return { 当前场景: scene, 返回按钮可见: !!b.offsetParent, 按钮文字: b.textContent };
