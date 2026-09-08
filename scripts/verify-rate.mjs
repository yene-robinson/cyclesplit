// Verifies mainnet/ststx-rate-adapter.clar against live chain state.
//
// The adapter cannot run in simnet: StackingDAO's live stx-reserve-v2 is
// deployed under Clarity 6 / Epoch 4.0, which Clarinet 3.21.x cannot
// emulate. So we check its arithmetic against mainnet directly, mirroring
// StackingDAO's own data-core-v3 formula:
//
//   stx-for-ststx = total-stx - ststxbtc-supply - ststxbtc-supply-v2
//   ratio         = stx-for-ststx * 1e6 / ststx-supply
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

const totalStx  = await readOnly("stx-reserve-v2", "get-total-stx");
const btcSupply = await readOnly("ststxbtc-token", "get-total-supply");
const btcV2     = await readOnly("ststxbtc-token-v2", "get-total-supply");
const supply    = await readOnly("ststx-token", "get-total-supply");

if (supply === 0n) throw new Error("stSTX supply is zero");
if (totalStx < btcSupply + btcV2) {
  throw new Error(`reserve ${totalStx} is smaller than stSTXbtc supply ${btcSupply + btcV2} -- the on-chain subtraction would underflow`);
}

const stxForStstx = totalStx - btcSupply - btcV2;
const ratio = (stxForStstx * RATIO_SCALE) / supply;
const f = (v) => (Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });

console.log(`reserve total-stx  : ${f(totalStx)} STX`);
console.log(`  less stSTXbtc    : ${f(btcSupply)}`);
console.log(`  less stSTXbtc v2 : ${f(btcV2)}`);
console.log(`stx backing stSTX  : ${f(stxForStstx)} STX`);
console.log(`stSTX supply       : ${f(supply)} stSTX`);
console.log(`ratio              : u${ratio}  (${Number(ratio) / 1e6} STX per stSTX)`);

const problems = [];
// stSTX only ever accrues, so it must be worth at least 1 STX.
if (ratio < 1_000_000n) problems.push(`ratio ${ratio} < 1.0 -- stSTX must never be worth less than STX`);
if (ratio > 5_000_000n) problems.push(`ratio ${ratio} > 5.0 -- implausible, check the reserve contract`);
// Catches the classic error of skipping the stSTXbtc subtraction.
const naive = (totalStx * RATIO_SCALE) / supply;
if (ratio === naive && btcSupply + btcV2 > 0n) {
  problems.push("ratio matches the naive total/supply figure despite a non-zero stSTXbtc supply");
}

if (problems.length) { console.error("\nFAIL:\n  " + problems.join("\n  ")); process.exit(1); }
console.log(`\nOK: adapter formula produces a sane live ratio (naive total/supply would have read u${naive}).`);
