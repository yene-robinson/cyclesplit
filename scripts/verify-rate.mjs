// Verifies mainnet/ststx-rate-adapter.clar against live chain state.
//
// The adapter cannot run in simnet: StackingDAO's live stx-reserve-v2 is
// deployed under Clarity 6 / Epoch 4.0, which Clarinet 3.21.x cannot
// emulate. So we check its arithmetic against mainnet directly.
//
//   ratio = stx-reserve-v2.get-total-stx * 1e6 / ststx-token.get-total-supply
//
// Run: node scripts/verify-rate.mjs
import { cvToString, hexToCV } from "@stacks/transactions";

const SD = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG";
const RATIO_SCALE = 1_000_000n;

async function readOnly(contract, fn) {
  const r = await fetch(`https://api.hiro.so/v2/contracts/call-read/${SD}/${contract}/${fn}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: SD, arguments: [] }),
  });
  const d = await r.json();
  if (!d.okay) throw new Error(`${contract}.${fn} failed: ${d.cause ?? JSON.stringify(d)}`);
  const m = cvToString(hexToCV(d.result)).match(/\d+/);
  if (!m) throw new Error(`${contract}.${fn}: unexpected ${cvToString(hexToCV(d.result))}`);
  return BigInt(m[0]);
}

const totalStx = await readOnly("stx-reserve-v2", "get-total-stx");
const supply = await readOnly("ststx-token", "get-total-supply");
if (supply === 0n) throw new Error("stSTX supply is zero");
const ratio = (totalStx * RATIO_SCALE) / supply;

console.log(`reserve total-stx : ${(Number(totalStx) / 1e6).toLocaleString()} STX`);
console.log(`stSTX supply      : ${(Number(supply) / 1e6).toLocaleString()} stSTX`);
console.log(`ratio             : u${ratio}  (${Number(ratio) / 1e6} STX per stSTX)`);

const problems = [];
if (ratio < 1_000_000n) problems.push(`ratio ${ratio} < 1.0 -- stSTX must never be worth less than STX`);
if (ratio > 5_000_000n) problems.push(`ratio ${ratio} > 5.0 -- implausible, check the reserve contract`);

// The drained legacy reserve reports ~u14851; catching that is the point.
if (ratio < 100_000n) problems.push("ratio looks like the drained reserve-v1 (~u14851)");

if (problems.length) { console.error("\nFAIL:\n  " + problems.join("\n  ")); process.exit(1); }
console.log("\nOK: adapter formula produces a sane live ratio.");
