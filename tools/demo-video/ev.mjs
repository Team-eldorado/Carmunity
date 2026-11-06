// node ev.mjs "<expression>"  : 스튜디오 창에서 식 실행
import { studioPage } from './lib.mjs';
const s = await studioPage();
try { console.log(JSON.stringify(await s.eval(process.argv[2]))); } catch (e) { console.log('ERR', e.message); }
process.exit(0);
