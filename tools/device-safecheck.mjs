// worker/room.js 的 sanitizeDevice / safeCount 檢查(沿用 tools/*check 的慣例)。
//   node tools/device-safecheck.mjs
//
// 由來:2026-09-04 安全檢視發現主控台有 stored XSS —— 玩家送的 deviceUpdate 與 shake
// 原樣進到 host.html 的 HTML 插值。真正的修法在伺服器端把型別收斂掉,這支就是釘住它。
import { sanitizeDevice, safeCount } from '../worker/room.js';

let fail = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) fail++;
};

const XSS = '<img src=x onerror=alert(document.domain)>';

console.log('sanitizeDevice');
const d = sanitizeDevice({
  ua: 'Mozilla/5.0 ' + 'x'.repeat(500),
  platform: XSS,
  screen: { w: XSS, h: '900', dpr: 2 },
  deviceMemory: XSS,
  hardwareConcurrency: '8',
  motionSupported: 'yes',
  motionPermission: 'granted',
  motionEventRateHz: XSS,
  connection: '4g',
  evil: XSS,
  __proto__: { polluted: true },
});
ok(d.motionEventRateHz === null, '非數字的 motionEventRateHz → null(這就是那條 XSS 的入口)');
ok(d.deviceMemory === null, '非數字的 deviceMemory → null');
ok(d.hardwareConcurrency === 8, '數字字串 → 數字');
ok(typeof d.platform === 'string' && d.platform.length <= 40, 'platform 仍是字串且限長 40');
ok(d.ua.length === 180, 'ua 截到 180');
ok(d.screen.w === null && d.screen.h === 900 && d.screen.dpr === 2, 'screen 逐欄位收斂');
ok(d.motionSupported === true, '布林強制成布林');
ok(!('evil' in d), '不認得的欄位丟掉');
ok(!('polluted' in d), '原型上的東西不會被抄進來');

console.log('sanitizeDevice:邊界');
ok(sanitizeDevice(null) === null, 'null → null');
ok(sanitizeDevice('nope') === null, '字串 → null');
ok(sanitizeDevice([1, 2]) === null, '陣列 → null');
ok(sanitizeDevice({}).screen === undefined, '沒給 screen 就不要憑空生一個');
ok(sanitizeDevice({ motionEventRateHz: null }).motionEventRateHz === null, 'null 維持 null,不能變成 0');
ok(sanitizeDevice({ motionEventRateHz: 0 }).motionEventRateHz === 0, '真的量到 0 Hz 要留住');

console.log('safeCount');
ok(safeCount(XSS) === 0, '字串 payload → 0');
ok(safeCount(12) === 12, '整數原樣');
ok(safeCount(5.9) === 5, '小數截斷');
ok(safeCount(-3) === 0, '負數夾到 0');
ok(safeCount(undefined) === 0, 'undefined → 0');
ok(safeCount(Infinity) === 0, 'Infinity → 0');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
