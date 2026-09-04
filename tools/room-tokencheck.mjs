// worker/token.js 的角色化房間憑證檢查(沿用 tools/*check 的慣例)。
//   node tools/room-tokencheck.mjs
//
// 由來:2026-09-04 安全檢視發現 WebSocket 的 host/client 只看 `?role=host` 這個查詢參數,
// 而房間憑證是印在 QR 上、每個玩家都有的 —— 任何掃過 QR 的人都能以主控身分連進來。
// 這支釘住的核心性質是:**client 憑證簽不出 host**。
import { mintToken, tokenOk, tokenRole } from '../worker/token.js';

let fail = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) fail++;
};

const S = 'test-room-secret-0123456789';
const ROOM = 'ABCD';
const exp = Date.now() + 60_000;

const clientTok = await mintToken(S, ROOM, exp, 'client');
const hostTok = await mintToken(S, ROOM, exp, 'host');

console.log('角色');
ok((await tokenRole(S, ROOM, hostTok)) === 'host', 'host 憑證 → host');
ok((await tokenRole(S, ROOM, clientTok)) === 'client', 'client 憑證 → client');
ok(hostTok !== clientTok, '兩張憑證不一樣');
ok((await tokenOk(S, ROOM, clientTok, 'host')) === false,
  '**client 憑證過不了 host 檢查**(掃 QR 的人升不了權)');
ok((await tokenOk(S, ROOM, hostTok, 'client')) === false, 'host 憑證也不會被當成 client 憑證');

console.log('既有 QR 相容');
ok((await tokenOk(S, ROOM, clientTok, 'client')) === true, 'client 憑證仍照舊格式驗得過');

console.log('拒絕');
ok((await tokenRole(S, ROOM, await mintToken(S, ROOM, Date.now() - 1, 'host'))) === null, '過期 → null');
ok((await tokenRole(S, 'WXYZ', hostTok)) === null, '換一個房號 → null');
ok((await tokenRole('other-secret', ROOM, hostTok)) === null, '換一把 secret → null');
ok((await tokenRole(S, ROOM, hostTok.slice(0, -1) + 'X')) === null, '簽章被改一個字元 → null');
ok((await tokenRole(S, ROOM, '')) === null, '空字串 → null');
ok((await tokenRole(S, ROOM, null)) === null, 'null → null');
ok((await tokenRole(S, ROOM, 'zzzz')) === null, '亂寫 → null');
ok((await tokenRole(S, ROOM, 'zzzz.short')) === null, '長度不符的簽章 → null(比對前先擋)');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
