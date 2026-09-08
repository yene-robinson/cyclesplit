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

> **Do not integrate via `data-core-v2/v3 get-stx-per-ststx`.** Post-PoX-5 it takes a
> `<reserve-trait>` whose `get-total-stx` returns `(response uint uint)`, while the live
> `stx-reserve-v2` returns a plain `uint` — the call no longer type-checks. The old
> `reserve-v1` is drained (701,055 STX, `get-stx-stacking` = `u0`) and reports a ratio of
> ~0.0148 instead of the true ~1.757. The adapter computes the ratio directly instead.

## Develop

```sh
clarinet check     # analyze all contracts (downloads mainnet requirements)
npm install
npm test           # 16 tests: lifecycle math + authorization guards
```

The lifecycle suite mirrors the contract math in exact BigInt arithmetic:
splitting, index accrual across ratio changes, fair settlement on YT
transfers, late-depositor fairness, maturity settlement, PT redemption, and
full conservation of funds.

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
