#!/usr/bin/env node
/**
 * Phase 0 / 0.2b 验证：不依赖真终端，能否
 *   ① 捕获 colab drivemount 打印的授权 URI
 *   ② 在用户授权后写回车解除 /dev/tty 阻塞
 *   ③ 读到 "Credentials propagated" / "Mounted at" 成功标志
 *
 * 用法：
 *   node pty-runner.mjs --mode=pipe  -- python3 fake_drivemount.py     # 对照组，预期失败
 *   node pty-runner.mjs --mode=pty   -- python3 fake_drivemount.py     # 实验组
 *   node pty-runner.mjs --mode=pty --auto-confirm=2000 -- <cmd...>
 *   node pty-runner.mjs --mode=pty --wait-file=/tmp/confirm -- <cmd...> # 等外部信号再确认
 */
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const flags = Object.fromEntries(
  (sep === -1 ? argv : argv.slice(0, sep))
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    }),
);
const cmd = sep === -1 ? [] : argv.slice(sep + 1);
if (cmd.length === 0) {
  console.error('用法: node pty-runner.mjs --mode=pty -- <command...>');
  process.exit(2);
}

const MODE = flags.mode ?? 'pty';
const AUTH_URI_RE = /(https:\/\/accounts\.google\.com\/o\/oauth2\/\S+)/;
const NEEDS_AUTH_RE = /REQUIRED:\s*Google Drive Authorization needed/i;
const PROPAGATED_RE = /Credentials propagated/i;
const MOUNTED_RE = /Mounted at (\S+)/;
const ALREADY_RE = /Drive already mounted|drive is already mounted/i;

const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(6, ' ');
const log = (tag, msg) => console.log(`[${ms()}ms] ${tag} ${msg}`);

let child;
if (MODE === 'pty') {
  // script -qec 给子进程分配一个真 PTY，且不依赖 node-pty 原生编译。
  // -q 静默, -e 返回子进程退出码, -c 执行命令, 输出丢弃到 /dev/null（我们用管道读）
  const inner = cmd.map((c) => (/[\s"'$]/.test(c) ? `'${c.replace(/'/g, `'\\''`)}'` : c)).join(' ');
  log('SPAWN', `script -qec "${inner}" /dev/null`);
  child = spawn('script', ['-qec', inner, '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
} else {
  log('SPAWN', `${cmd.join(' ')}  (纯管道，无 PTY —— 对照组)`);
  child = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
}

const result = {
  mode: MODE,
  authUri: null,
  needsAuth: false,
  confirmedAt: null,
  propagated: false,
  mountPath: null,
  alreadyMounted: false,
  exitCode: null,
  error: null,
};

let buf = '';
let confirmScheduled = false;

function onChunk(chunk, stream) {
  const text = chunk.toString('utf8');
  process.stdout.write(text.replace(/^/gm, `[${ms()}ms] ${stream}| `));
  buf += text;

  if (!result.needsAuth && NEEDS_AUTH_RE.test(buf)) {
    result.needsAuth = true;
    log('DETECT', '✅ 检测到需要 Drive 授权');
  }
  if (!result.authUri) {
    const m = buf.match(AUTH_URI_RE);
    if (m) {
      result.authUri = m[1].trim();
      log('DETECT', `✅ 捕获到授权 URI（${result.authUri.length} 字符）`);
      scheduleConfirm();
    }
  }
  if (!result.propagated && PROPAGATED_RE.test(buf)) {
    result.propagated = true;
    log('DETECT', '✅ 凭据推送成功 (Credentials propagated)');
  }
  if (!result.mountPath) {
    const m = buf.match(MOUNTED_RE);
    if (m) {
      result.mountPath = m[1];
      log('DETECT', `✅ 挂载成功于 ${result.mountPath}`);
    }
  }
  if (!result.alreadyMounted && ALREADY_RE.test(buf)) {
    result.alreadyMounted = true;
    log('DETECT', 'ℹ️  该会话此前已挂载');
  }
}

function writeConfirm(why) {
  result.confirmedAt = Date.now() - t0;
  log('WRITE', `→ 向子进程写入换行（${why}）`);
  child.stdin.write('\n');
}

function scheduleConfirm() {
  if (confirmScheduled) return;
  confirmScheduled = true;

  if (flags['auto-confirm']) {
    const delay = Number(flags['auto-confirm']);
    log('WAIT', `将在 ${delay}ms 后自动确认`);
    setTimeout(() => writeConfirm(`auto-confirm ${delay}ms`), delay);
    return;
  }

  if (flags['wait-file']) {
    const f = String(flags['wait-file']);
    if (existsSync(f)) unlinkSync(f);
    log('WAIT', `等待信号文件出现: ${f}`);
    log('WAIT', `完成浏览器授权后执行:  touch ${f}`);
    const iv = setInterval(() => {
      if (existsSync(f)) {
        clearInterval(iv);
        unlinkSync(f);
        writeConfirm(`信号文件 ${f}`);
      }
    }, 500);
    const timeoutMs = Number(flags['timeout'] ?? 600000);
    setTimeout(() => {
      clearInterval(iv);
      if (!result.confirmedAt) {
        log('TIMEOUT', `⏱ ${timeoutMs}ms 内未收到确认，放弃`);
        child.kill('SIGTERM');
      }
    }, timeoutMs);
    return;
  }

  log('WAIT', '未指定 --auto-confirm / --wait-file，不自动确认');
}

child.stdout.on('data', (c) => onChunk(c, 'OUT'));
child.stderr.on('data', (c) => onChunk(c, 'ERR'));
child.on('error', (e) => {
  result.error = e.message;
  log('ERROR', e.message);
});
child.on('exit', (code, signal) => {
  result.exitCode = code ?? `signal:${signal}`;
  console.log('\n' + '='.repeat(72));
  log('EXIT', `子进程退出 code=${result.exitCode}`);
  console.log('RESULT ' + JSON.stringify(result, null, 2));

  const ok = result.authUri && result.confirmedAt !== null && (result.propagated || result.mountPath);
  const skipped = result.mountPath && !result.needsAuth;
  console.log('='.repeat(72));
  if (ok) console.log(`✅ ${MODE.toUpperCase()} 模式：完整链路跑通（捕获 URI → 写回车 → 挂载成功）`);
  else if (skipped) console.log(`✅ ${MODE.toUpperCase()} 模式：无需授权，直接挂载成功`);
  else console.log(`❌ ${MODE.toUpperCase()} 模式：链路未跑通`);
  process.exit(ok || skipped ? 0 : 1);
});

// 全局超时兜底
setTimeout(() => {
  log('ABORT', '全局超时，杀掉子进程');
  child.kill('SIGKILL');
}, Number(flags['hard-timeout'] ?? 900000));
