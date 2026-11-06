import { networkInterfaces } from 'node:os';
import { createApp } from './app.js';
import { buildRoutes } from './routes.js';
import { startHttp } from './http.js';
import { seed } from './seed.js';
import { PORT, DATA_FILE } from './config.js';

const app = createApp({ dataFile: DATA_FILE });
if (!app.ctx.load()) seed(app);

// 영상 메타데이터 72시간 보관 → 매시간 정리
setInterval(() => app.audit.purgeExpired(), 3600_000).unref();

startHttp(buildRoutes(app), PORT);

const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
console.log(`카뮤니티 서버 실행 중: http://localhost:${PORT}`);
for (const ip of lan) console.log(`  같은 Wi-Fi 휴대폰: http://${ip}:${PORT}`);
console.log(`  에뮬레이터(차량 앱)에서는: http://10.0.2.2:${PORT}`);
console.log(`  데모 콘솔: http://localhost:${PORT}/#/demo`);
