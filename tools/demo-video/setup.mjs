// 스튜디오 창을 띄워 기본 모니터 전체 화면(1920×1080)으로 만든다.  node setup.mjs [--preview]
// --preview: 전체 화면으로 만들지 않는다 (shot.mjs로 1920×1080 캡처해 확인할 때)
import { STUDIO_URL, launchChrome, targets, browser, sleep } from './lib.mjs';

const preview = process.argv.includes('--preview');
const hasStudio = (ts) => ts?.some((t) => t.type === 'page' && t.url.includes('#/studio'));
let ts = await targets().catch(() => null);
if (!hasStudio(ts)) {
  launchChrome(STUDIO_URL);
  for (let i = 0; i < 40 && !hasStudio(ts = await targets().catch(() => null)); i++) await sleep(500);
}
const b = await browser();
for (const t of await targets()) if (t.type === 'page' && !t.url.includes('#/studio')) await b.send('Target.closeTarget', { targetId: t.id }).catch(() => {});
const t = (await targets()).find((x) => x.type === 'page' && x.url.includes('#/studio'));
const { windowId } = await b.send('Browser.getWindowForTarget', { targetId: t.id });
await b.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
await b.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1280, height: 760 } });
if (!preview) {
  await sleep(300);
  await b.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
}
console.log('studio ready', preview ? '(preview)' : '(fullscreen)');
await b.close();
process.exit(0);
