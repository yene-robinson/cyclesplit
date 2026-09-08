# CycleSplit

Fixed-maturity yield trading for Bitcoin Staking rewards on Stacks — split
stSTX into a **Principal Token (PT)** and a **Yield Token (YT)**, Pendle-style.

Answers the Stacks Endowment RFP **"Bitcoin Staking Yield Trading Markets"**
(monetize Stacks Bitcoin Staking rewards through yield speculation).

## How it works

```
                     deposit 100 stSTX (ratio 1.10)
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
  110 PT-stSTX                                  110 YT-stSTX
  1 unit = 1 uSTX of principal            claims all stacking yield
  at maturity (fixed rate when            accrued from entry until
  bought at a discount)                   maturity (leveraged APY bet,
                                          no liquidation risk)
        │                                             │
        └───────────── maturity (burn height, ────────┘
                       aligned to a PoX cycle)
        PT redeems amount×1e6/ratio_m stSTX     YT stops accruing;
        (= its fixed STX value)                 holder claims remainder
```

- **Yield accounting:** as StackingDAO's stSTX/STX ratio rises, the stSTX
  needed to back 1 µSTX of principal shrinks. The freed stSTX streams to YT
  holders through a monotone global index; per-user checkpoints settle on
  every YT mint, burn, and transfer, so YT stays fungible and yield
  attribution stays fair across entry times.
- **No oracle:** the ratio is read onchain from StackingDAO's canonical
  `data-core-v2` contract. **No margin, no liquidations, no keepers.**
- **Rounding:** every division rounds down, so dust accrues to the vault,
  never against it (proven in the conservation test: 150 stSTX through a
  full lifecycle leaves exactly 3 µunits behind).

## Contracts

| Contract | Purpose |
|---|---|
| `cyclesplit-vault` | Deposit/split, sync, pair exit, maturity settlement, PT redemption, yield claims |
| `pt-ststx` | SIP-010 principal token, vault-gated mint/burn |
| `yt-ststx` | SIP-010 yield token with checkpointed accrual index |
| `rate-source-trait` | Minimal ratio interface (STX per stSTX, 6 decimals) |
| `mock-ststx-token`, `mock-rate-source`, `mock-rate-source-2` | Test doubles (never deployed to mainnet) |

Canonical dependency (auto-fetched by Clarinet as a requirement):

- `SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard`

### The mainnet rate adapter lives outside the simnet build

`mainnet/ststx-rate-adapter.clar` reads the live ratio from StackingDAO's
`stx-reserve-v2` + `ststx-token`. It is **deliberately not** in `Clarinet.toml`:
`stx-reserve-v2` is deployed under **Clarity 6 / Epoch 4.0**, which Clarinet 3.21.x
cannot emulate in simnet (`NoSuchContract` at boot). Unit tests therefore drive a
deterministic `mock-rate-source`, and the adapter's arithmetic is verified against
live chain state instead:

```sh
node scripts/verify-rate.mjs
```

**Two integration traps, both live as of 8 Sep 2026:**

> **1. The reserve backs two tokens.** `stx-reserve-v2` backs stSTX *and* stSTXbtc, so the
> ratio is `(total-stx − ststxbtc-supply − ststxbtc-supply-v2) × 1e6 / ststx-supply`, per
> StackingDAO's own `data-core-v3`. Skipping the subtraction reads **u1720578** against a
> true **u1169705** — a ~47% overstatement that would mint far too many principal units
> per deposit and leave the vault unable to redeem every PT. `verify-rate.mjs` fails if the
> computed ratio matches the naive figure while stSTXbtc supply is non-zero.

> **2. Do not call `data-core-v2/v3 get-stx-per-ststx`.** It takes a `<reserve-trait>` whose
> `get-total-stx` returns `(response uint uint)`, while the live `stx-reserve-v2` returns a
> plain `uint`, so the call no longer type-checks. The old `reserve-v1` is drained
> (701,055 STX, `get-stx-stacking` = `u0`) and reports ~0.0148. The adapter reimplements
> the v3 formula against the live contracts instead.

## Develop

```sh
clarinet check     # analyze all contracts (downloads mainnet requirements)
npm install
npm test           # 20 tests: lifecycle math, authorization guards, hostile contracts
```

The lifecycle suite mirrors the contract math in exact BigInt arithmetic:
splitting, index accrual across ratio changes, fair settlement on YT
transfers, late-depositor fairness, maturity settlement, PT redemption, and
full conservation of funds.

## Security posture

The vault takes `<sip-010-token>` and `<rate-source>` as call parameters — the
same surface the June 2025 ALEX Protocol exploit used, where a fake token
carrying a malicious `transfer` was accepted by a protocol that took arbitrary
tokens and then used to drain pooled funds. Both are pinned here to a single
principal fixed at `initialize`, so a foreign contract is rejected before any of
its code runs. `tests/cyclesplit-hostile.test.ts` proves this with a real
attacker contract: it asserts the rejection *and* that the attacker's
`transfer` was invoked zero times, including when the token is set to report
success without moving funds.

Structural properties worth stating:

- **No privileged role after setup.** `initialize` and `set-vault` each run once
  and cannot be repeated. There is no pause, no admin withdrawal, no upgrade
  path, no flag to flip — so a compromised deployer key cannot touch a live
  series. The trade-off is deliberate: no admin also means no emergency stop.
- **No bridge, no pools, no price oracle, no leverage, no liquidations.** The
  ratio is an accounting figure (reserve ÷ supply), not a market price, so it
  cannot be moved by trading against it.
- **Funds only leave against burned tokens.** Every outflow path burns PT/YT or
  clears an accrual entry before the external transfer.

The contracts are **unaudited**. The largest residual risk is the StackingDAO
dependency: if their reserve accounting changes, the ratio this protocol reads
changes with it.

## Deployment (per maturity series)

1. Deploy `rate-source-trait`, `mainnet/ststx-rate-adapter`, `pt-ststx`, `yt-ststx`,
   `cyclesplit-vault`. Run `node scripts/verify-rate.mjs` first — it fails loudly if the
   adapter would read a stale or drained reserve.
2. `pt-ststx.set-vault` and `yt-ststx.set-vault` → vault principal (one-time,
   immutable).
3. `cyclesplit-vault.initialize(ststx-token, ststx-rate-adapter, maturity-burn-height)`
   with `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token` and a maturity
   ~6 months out (≈13 PoX cycles; cycles are 2100 Bitcoin blocks), aligned to a cycle
   boundary. Short cycle-length maturities are economically dead: a two-week YT captures
   ~0.4% of principal at a 10% annual rate.
4. Run the subscription window (fixed lane / yield lane). The clearing fixed rate for
   the series is `Y / F` — the ratio of yield-lane to fixed-lane subscription. Secondary
   DEX listing is optional upside, not a launch dependency: constant-product pools bleed
   LPs systematically on PT (→ par) and YT (→ zero).

Each maturity is an independent deployment of the three protocol contracts;
`ststx-rate-adapter` is shared across all series.

## MVP scope notes / roadmap

- `sync` is permissionless and is called automatically on deposit, pair
  exit, claim, and settlement. A YT transfer settles at the last pushed
  index, so frontends should batch a `sync` before large transfers.
- Fee switch (basis points on split/redeem) intentionally deferred.
- Second asset (LiSTX) and an SIP-013 multi-series design are post-grant
  candidates once the single-series model is proven on mainnet.
