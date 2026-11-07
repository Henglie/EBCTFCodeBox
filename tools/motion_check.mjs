// Deterministic spring checks: low-frame-rate stability, retargeting and preferences.
import assert from "node:assert/strict";

let clock = 0, nextId = 0, reduced = false, checks = 0;
const frames = new Map();
const storage = new Map();
globalThis.document = { documentElement: {
  dataset: { motionSpeed: "1" }, classList: { contains: name => name === "reduce-motion" && reduced },
  style: { setProperty() {} },
} };
globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
globalThis.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId; };
Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true });
const { HLSpring } = await import("../src/ui/spring.js");
const { setMotionSpeed, getMotionSpeed, initMotionPreferences } = await import("../src/ui/motionPreferences.js");
const check = (condition, label) => { assert(condition, label); checks++; };
const step = delta => {
  clock += delta;
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach(callback => callback(clock));
};
const xOf = node => Number(node.style.transform.match(/translate\(([-.\d]+)px/)[1]);

for (const pace of [0.75, 1, 1.25]) {
  setMotionSpeed(pace);
  for (const delta of [1000 / 60, 1000 / 30, 1000]) {
    for (const preset of ["dur75", "dur150", "dur200", "dur250", "bouncy150", "bouncy250"]) {
      const node = { style: {} };
      let rests = 0, valid = true, monotonic = true, previous = 0;
      HLSpring.set(node, { x: 0 });
      HLSpring.to(node, { x: 100 }, { preset, onRest: () => rests++ });
      for (let i = 0; i < 240; i++) {
        step(delta);
        const x = xOf(node);
        valid &&= Number.isFinite(x) && x >= 0 && x < 140;
        monotonic &&= x >= previous;
        previous = x;
      }
      check(valid && xOf(node) === 100 && rests === 1, `${pace}/${delta}/${preset}: stable convergence and one completion`);
      if (preset.startsWith("dur")) check(monotonic, `${pace}/${delta}/${preset}: no overshoot`);
    }
  }
}

setMotionSpeed(1);
const node = { style: {} };
HLSpring.set(node, { x: 0 });
HLSpring.to(node, { x: 100 }, "gentle");
for (let i = 0; i < 4; i++) step(1000 / 60);
const interrupted = node.style.transform;
HLSpring.to(node, { x: -40 }, "gentle");
check(node.style.transform === interrupted, "Retargeting does not reset the current position");
for (let i = 0; i < 240; i++) step(1000 / 60);
check(xOf(node) === -40, "Retargeting settles on the new target");

reduced = true;
let immediate = 0;
HLSpring.to(node, { x: 42 }, { preset: "bouncy250", onRest: () => immediate++ });
check(xOf(node) === 42 && immediate === 1 && frames.size === 0, "Reduced motion applies final state synchronously");
setMotionSpeed(1.25);
setMotionSpeed(0.75, false);
initMotionPreferences();
check(getMotionSpeed() === 1.25, "Motion pace persists");
setMotionSpeed("invalid");
check(getMotionSpeed() === 1, "Invalid preference falls back to standard");
console.log(JSON.stringify({ verdict: "PASS", checks }));
