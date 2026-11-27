import { describe, expect, it } from 'vitest';
import {
  arrived,
  clientMessageSchema,
  IDLE_INPUT,
  rotateTowards,
  sanitizeInput,
  selfState,
  stepShip,
  TICK_MS,
  wrapAngle,
  type MoveInput,
  type ShipState,
} from './net.js';

const DT = TICK_MS / 1000;
const W = 20000;
const H = 12500;
const fresh = (x = 5000, y = 5000): ShipState => ({ x, y, vx: 0, vy: 0, h: -Math.PI / 2 });

describe('stepShip (sunucu ve istemcide ortak hareket)', () => {
  it('yön girdisiyle gemi hızlanır ama gemi hızını asla aşmaz', () => {
    const s = fresh();
    let maxV = 0;
    for (let i = 0; i < 100; i++) {
      stepShip(s, { m: 1, x: 1, y: 0 }, DT, 320, W, H);
      maxV = Math.max(maxV, Math.hypot(s.vx, s.vy));
    }
    expect(maxV).toBeLessThanOrEqual(320 + 1e-9);
    expect(maxV).toBeGreaterThan(319);
    // 5 sn'de en fazla 5 × 320 = 1600 birim
    expect(s.x - 5000).toBeLessThanOrEqual(1600);
    expect(s.x - 5000).toBeGreaterThan(1350);
    expect(Math.abs(s.y - 5000)).toBeLessThan(1e-9);
    expect(Math.abs(wrapAngle(s.h - 0))).toBeLessThan(0.01); // sağa döndü
  });

  it('çapraz yön de hız sınırını aşmaz (normalize edilir)', () => {
    const s = fresh();
    for (let i = 0; i < 100; i++) stepShip(s, { m: 1, x: 1, y: 1 }, DT, 320, W, H);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(320 + 1e-9);
  });

  it('hedefe gider, yavaşlar ve durur', () => {
    const s = fresh();
    const target: MoveInput = { m: 2, x: 5600, y: 5300 };
    let i = 0;
    while (!arrived(s, target) && i++ < 400) stepShip(s, target, DT, 320, W, H);
    expect(i).toBeLessThan(400);
    expect(Math.hypot(s.x - 5600, s.y - 5300)).toBeLessThan(8);
  });

  it('dur girdisiyle yavaşlar ve tamamen durur; harita sınırına kırpılır', () => {
    const s = fresh(19990, 100);
    for (let i = 0; i < 40; i++) stepShip(s, { m: 1, x: 1, y: -1 }, DT, 320, W, H);
    expect(s.x).toBe(W);
    expect(s.y).toBe(0);
    for (let i = 0; i < 80; i++) stepShip(s, IDLE_INPUT, DT, 320, W, H);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
  });

  it('hız 0 olan gemi hareket etmez', () => {
    const s = fresh();
    for (let i = 0; i < 20; i++) stepShip(s, { m: 1, x: 1, y: 0 }, DT, 0, W, H);
    expect(s.x).toBe(5000);
  });

  it('uzlaştırma: sunucu durumundan (yuvarlanmış) onaylanmamış girdileri yeniden oynatmak doğrudan sonuca çok yakındır', () => {
    const inputs: MoveInput[] = [];
    for (let i = 0; i < 60; i++) inputs.push(i < 20 ? { m: 1, x: 1, y: 0 } : i < 35 ? { m: 1, x: 0, y: 1 } : { m: 2, x: 6000, y: 4000 });
    const direct = fresh();
    for (const inp of inputs) stepShip(direct, inp, DT, 320, W, H);
    // Sunucu ilk 30 girdiyi işlemiş ve durumu yuvarlayıp göndermiş olsun
    const server = fresh();
    for (const inp of inputs.slice(0, 30)) stepShip(server, inp, DT, 320, W, H);
    const [x, y, vx, vy, h] = selfState(server);
    const replay: ShipState = { x, y, vx, vy, h };
    for (const inp of inputs.slice(30)) stepShip(replay, inp, DT, 320, W, H);
    expect(Math.hypot(replay.x - direct.x, replay.y - direct.y)).toBeLessThan(0.5);
  });

  it('açı yardımcıları: en kısa yönden döner', () => {
    expect(rotateTowards(3, -3, 0.1)).toBeCloseTo(3.1, 5);
    expect(Math.abs(Math.abs(wrapAngle(Math.PI * 3)) - Math.PI)).toBeLessThan(1e-9); // [-π, π) aralığı
  });
});

describe('istemci mesaj şeması', () => {
  it('geçerli mesajları kabul eder', () => {
    expect(clientMessageSchema.safeParse({ t: 'hello', v: 1, ticket: 'x'.repeat(43) }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'in', i: [[1, 1, 0.5, -1]] }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'jump', p: 3 }).success).toBe(true);
  });
  it('bilinmeyen alan, sonsuz sayı, fazla komut ve konum yazma girişimi reddedilir', () => {
    expect(clientMessageSchema.safeParse({ t: 'in', i: [[1, 1, 0, 0]], x: 5 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'in', i: [[1, 1, Number.NaN, 0]] }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'in', i: Array.from({ length: 11 }, (_, k) => [k, 0, 0, 0]) }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'pos', x: 100, y: 100 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'in', i: [[1, 3, 0, 0]] }).success).toBe(false);
  });
  it('girdi temizleme: yön [-1,1], hedef harita sınırı', () => {
    expect(sanitizeInput([1, 1, 50, -9], W, H)).toEqual({ m: 1, x: 1, y: -1 });
    expect(sanitizeInput([1, 2, -50, 99999], W, H)).toEqual({ m: 2, x: 0, y: H });
    expect(sanitizeInput([1, 0, 4, 4], W, H)).toEqual({ m: 0, x: 0, y: 0 });
  });
});
