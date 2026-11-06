// 스튜디오 화면을 1920×1080으로 캡처 (확인용)  node shot.mjs out.png ["실행할 JS"]
import { writeFileSync } from 'node:fs';
import { studioPage, sleep } from './lib.mjs';

const s = await studioPage();
await s.c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
if (process.argv[3]) await s.eval(process.argv[3]);
await sleep(Number(process.env.WAIT || 1500));
const { data } = await s.c.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(process.argv[2] || 'shot.png', Buffer.from(data, 'base64'));
process.exit(0);
