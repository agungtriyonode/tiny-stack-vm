// Tiny stack VM for make.fun's tiny-stack-vm-01 (ISA v1).
// My own interpreter of generator/subject/ISA.md, written from the spec and
// the reference VM's observable behaviour. Runs every /input/<id>/program.bin
// on its input.bin and writes /output/<id>/stdout.bin + exit.txt.
// Node 22, built-ins only, fully deterministic (no clock/env reads).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let cp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  const db = new Uint8Array(11);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let st = 0;
  const t = (c) => ({ o: out.slice(0, ol), c });
  for (;;) {
    if (st === 1e6) return t(10);
    if (pc < 0 || pc >= n) return t(9);
    const op = p[pc];
    let imm = 0;
    let pops = 0;
    let push = 0;
    if (op === 0x01) { imm = 1; push = 1; }
    else if (op === 0x02) { imm = 4; push = 1; }
    else if (op === 0x30 || op === 0x33) imm = 2;
    else if (op === 0x31 || op === 0x32) { imm = 2; pops = 1; }
    else if (op === 0x03) pops = 1;
    else if (op === 0x04) { pops = 1; push = 2; }
    else if (op === 0x05) { pops = 2; push = 2; }
    else if (op === 0x06) { pops = 2; push = 3; }
    else if (op === 0x07) { pops = 3; push = 3; }
    else if (op === 0x17 || op === 0x1b) { pops = 1; push = 1; }
    else if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b && op !== 0x1f) { pops = 2; push = 1; }
    else if (op === 0x40) { pops = 1; push = 1; }
    else if (op === 0x41 || op === 0x50 || op === 0x51 || op === 0x53) pops = 1;
    else if (op === 0x52) push = 1;
    else if (op === 0x00 || op === 0x34) { /* HALT, RET: no stack change */ }
    else return t(5);
    if (pc + imm >= n) return t(9);
    st++;
    if (sp < pops) return t(2);
    if (sp - pops + push > 256) return t(3);
    const nx = pc + 1 + imm;
    pc = nx;
    switch (op) {
      case 0x00:
        return { o: out.slice(0, ol), c: 0 };
      case 0x01:
        D[sp++] = (p[nx - 1] << 24) >> 24;
        break;
      case 0x02:
        D[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 0x05: {
        const w = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = w;
        break;
      }
      case 0x06:
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 0x17:
        D[sp - 1] = -D[sp - 1] | 0;
        break;
      case 0x1b:
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16:
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x20:
      case 0x21:
      case 0x22: {
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return t(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return t(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return t(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return t(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          const v = D[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return t(7);
        C[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return t(8);
        pc = C[--cp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return t(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1];
        const v = D[sp - 2];
        if (addr < 0 || addr >= 256) return t(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 0x50: {
        // PRINT: decimal straight into `out` (digits reversed into `db`),
        // no String allocation per call; trap 11 still writes nothing.
        let v = D[sp - 1];
        const neg = v < 0;
        let u = neg ? -v : v;
        let d = 0;
        do { db[d++] = 48 + (u % 10); u = (u / 10) | 0; } while (u);
        if (ol + d + (neg ? 1 : 0) > 65536) return t(11);
        sp--;
        if (neg) out[ol++] = 45;
        while (d) out[ol++] = db[--d];
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return t(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        return { o: out.slice(0, ol), c: D[--sp] & 255 };
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.o);
  writeFileSync(join(O, id, 'exit.txt'), `${r.c}\n`);
}
