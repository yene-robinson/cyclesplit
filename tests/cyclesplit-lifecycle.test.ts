import { beforeEach, describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// Full lifecycle with exact integer math mirroring the contracts.
// The clarinet environment resets simnet between tests, so each test
// replays the protocol stages it needs via the helpers below.
// Ratio = STX per stSTX scaled 1e6; yield index scaled 1e12.

const RATIO_SCALE = 1_000_000n;
const INDEX_SCALE = 1_000_000_000_000n;
const backing = (r: bigint) => (INDEX_SCALE * RATIO_SCALE) / r;

const R0 = 1_100_000n; // genesis: 1.10 STX per stSTX
const R1 = 1_155_000n; // +5% growth
const R2 = 1_200_000n;
const R3 = 1_260_000n; // final ratio at maturity

const Y1 = backing(R0) - backing(R1);
const Y2 = backing(R0) - backing(R2);
const Y3 = backing(R0) - backing(R3);

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const alice = accounts.get("wallet_1")!;
const bob = accounts.get("wallet_2")!;

const vaultPrincipal = `${deployer}.cyclesplit-vault`;
const ststx = Cl.contractPrincipal(deployer, "mock-ststx-token");
const rateSource = Cl.contractPrincipal(deployer, "mock-rate-source");

// expected values
const aliceDeposit = 100_000_000n; // 100 stSTX
const aliceUnits = (aliceDeposit * R0) / RATIO_SCALE; // 110_000_000
const bobDeposit = 50_000_000n;
const bobUnits = (bobDeposit * R2) / RATIO_SCALE; // 60_000_000
const claim1 = (aliceUnits * Y1) / INDEX_SCALE;
const transferAmount = 55_000_000n;
const claim2 = (transferAmount * (Y2 - Y1)) / INDEX_SCALE; // alice and bob each
const aliceFinal = (transferAmount * (Y3 - Y2)) / INDEX_SCALE;
const bobFinal = ((transferAmount + bobUnits) * (Y3 - Y2)) / INDEX_SCALE;
const alicePtOut = (aliceUnits * RATIO_SCALE) / R3;
const bobPtOut = (bobUnits * RATIO_SCALE) / R3;

let maturityHeight: bigint;

const setRatio = (r: bigint) =>
  simnet.callPublicFn("mock-rate-source", "set-ratio", [Cl.uint(r)], deployer);

const sync = () => simnet.callPublicFn("cyclesplit-vault", "sync", [rateSource], deployer);

const claim = (who: string) =>
  simnet.callPublicFn("cyclesplit-vault", "claim-yield", [ststx, rateSource], who);

const preview = (who: string) =>
  simnet.callReadOnlyFn("yt-ststx", "get-accrued-preview", [Cl.principal(who)], who).result;

const ststxBalance = (who: string) =>
  simnet.callReadOnlyFn("mock-ststx-token", "get-balance", [Cl.principal(who)], deployer).result;

// stage helpers ---------------------------------------------------------

const stageInit = () => {
  simnet.callPublicFn("pt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer);
  simnet.callPublicFn("yt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer);
  simnet.callPublicFn("mock-ststx-token", "mint", [Cl.uint(1_000_000_000n), Cl.principal(alice)], deployer);
  simnet.callPublicFn("mock-ststx-token", "mint", [Cl.uint(1_000_000_000n), Cl.principal(bob)], deployer);
  setRatio(R0);
  maturityHeight = BigInt(simnet.burnBlockHeight) + 50n;
  simnet.callPublicFn("cyclesplit-vault", "initialize", [ststx, rateSource, Cl.uint(maturityHeight)], deployer);
};

const stageAliceDeposit = () =>
  simnet.callPublicFn("cyclesplit-vault", "deposit", [Cl.uint(aliceDeposit), ststx, rateSource], alice);

const stageFirstClaim = () => {
  setRatio(R1);
  sync();
  return claim(alice);
};

const stageTransferAndSecondClaims = () => {
  simnet.callPublicFn(
    "yt-ststx",
    "transfer",
    [Cl.uint(transferAmount), Cl.principal(alice), Cl.principal(bob), Cl.none()],
    alice
  );
  setRatio(R2);
  sync();
  return { alice: claim(alice), bob: claim(bob) };
};

const stageBobDeposit = () =>
  simnet.callPublicFn("cyclesplit-vault", "deposit", [Cl.uint(bobDeposit), ststx, rateSource], bob);

const stageSettle = () => {
  simnet.mineEmptyBurnBlocks(60);
  setRatio(R3);
  return simnet.callPublicFn("cyclesplit-vault", "settle-maturity", [rateSource], bob);
};

const stageRedeemPts = () => ({
  alice: simnet.callPublicFn("cyclesplit-vault", "redeem-pt", [Cl.uint(aliceUnits), ststx], alice),
  bob: simnet.callPublicFn("cyclesplit-vault", "redeem-pt", [Cl.uint(bobUnits), ststx], bob),
});

beforeEach(stageInit);

// tests -----------------------------------------------------------------

describe("cyclesplit lifecycle", () => {
  it("initializes with genesis config", () => {
    const { result } = simnet.callReadOnlyFn("cyclesplit-vault", "get-info", [], deployer);
    expect(result).toBeTuple({
      initialized: Cl.bool(true),
      "ststx-token": Cl.some(ststx),
      "rate-source": Cl.some(rateSource),
      "maturity-height": Cl.uint(maturityHeight),
      "genesis-ratio": Cl.uint(R0),
      "current-ratio": Cl.uint(R0),
      settled: Cl.bool(false),
      "maturity-ratio": Cl.uint(0),
      "burn-height": Cl.uint(simnet.burnBlockHeight),
    });
  });

  it("splits stSTX into equal PT and YT at the current ratio", () => {
    expect(stageAliceDeposit().result).toBeOk(Cl.uint(aliceUnits));
    expect(
      simnet.callReadOnlyFn("pt-ststx", "get-balance", [Cl.principal(alice)], alice).result
    ).toBeOk(Cl.uint(aliceUnits));
    expect(
      simnet.callReadOnlyFn("yt-ststx", "get-balance", [Cl.principal(alice)], alice).result
    ).toBeOk(Cl.uint(aliceUnits));
    expect(ststxBalance(vaultPrincipal)).toBeOk(Cl.uint(aliceDeposit));
  });

  it("accrues yield to YT as the stSTX ratio rises", () => {
    stageAliceDeposit();
    setRatio(R1);
    sync();
    expect(preview(alice)).toBeUint(claim1);

    expect(claim(alice).result).toBeOk(Cl.uint(claim1));
    expect(ststxBalance(alice)).toBeOk(Cl.uint(1_000_000_000n - aliceDeposit + claim1));

    // nothing left to claim at the same index
    expect(claim(alice).result).toBeErr(Cl.uint(310));
  });

  it("settles both parties on YT transfer, splitting future yield fairly", () => {
    stageAliceDeposit();
    stageFirstClaim();

    simnet.callPublicFn(
      "yt-ststx",
      "transfer",
      [Cl.uint(transferAmount), Cl.principal(alice), Cl.principal(bob), Cl.none()],
      alice
    );
    setRatio(R2);
    sync();

    expect(preview(alice)).toBeUint(claim2);
    expect(preview(bob)).toBeUint(claim2);
    expect(claim(alice).result).toBeOk(Cl.uint(claim2));
    expect(claim(bob).result).toBeOk(Cl.uint(claim2));
  });

  it("later depositors mint at the current ratio and start with zero accrual", () => {
    stageAliceDeposit();
    stageFirstClaim();
    stageTransferAndSecondClaims();

    expect(stageBobDeposit().result).toBeOk(Cl.uint(bobUnits));
    expect(
      simnet.callReadOnlyFn("yt-ststx", "get-balance", [Cl.principal(bob)], bob).result
    ).toBeOk(Cl.uint(transferAmount + bobUnits));
    expect(preview(bob)).toBeUint(0n);

    // PT is freely transferable
    simnet.callPublicFn(
      "pt-ststx",
      "transfer",
      [Cl.uint(10_000_000n), Cl.principal(alice), Cl.principal(bob), Cl.none()],
      alice
    );
    simnet.callPublicFn(
      "pt-ststx",
      "transfer",
      [Cl.uint(10_000_000n), Cl.principal(bob), Cl.principal(alice), Cl.none()],
      bob
    );
    expect(
      simnet.callReadOnlyFn("pt-ststx", "get-balance", [Cl.principal(alice)], alice).result
    ).toBeOk(Cl.uint(aliceUnits));
  });

  it("rejects settlement before maturity, then deposits after maturity", () => {
    stageAliceDeposit();
    expect(
      simnet.callPublicFn("cyclesplit-vault", "settle-maturity", [rateSource], alice).result
    ).toBeErr(Cl.uint(307));

    simnet.mineEmptyBurnBlocks(60);

    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "deposit",
        [Cl.uint(1_000_000n), ststx, rateSource],
        alice
      ).result
    ).toBeErr(Cl.uint(306));
  });

  it("settles at maturity and freezes the series", () => {
    stageAliceDeposit();
    expect(stageSettle().result).toBeOk(Cl.uint(R3));
    expect(
      simnet.callPublicFn("cyclesplit-vault", "settle-maturity", [rateSource], bob).result
    ).toBeErr(Cl.uint(308));
    expect(simnet.callPublicFn("cyclesplit-vault", "sync", [rateSource], bob).result).toBeErr(
      Cl.uint(308)
    );
  });

  it("redeems PT for its fixed principal at the maturity ratio", () => {
    stageAliceDeposit();
    stageFirstClaim();
    stageTransferAndSecondClaims();
    stageBobDeposit();
    stageSettle();

    const redeems = stageRedeemPts();
    expect(redeems.alice.result).toBeOk(Cl.uint(alicePtOut));
    expect(redeems.bob.result).toBeOk(Cl.uint(bobPtOut));
    expect(simnet.callReadOnlyFn("pt-ststx", "get-total-supply", [], deployer).result).toBeOk(
      Cl.uint(0)
    );
  });

  it("pays final YT claims and keeps only rounding dust", () => {
    stageAliceDeposit();
    stageFirstClaim();
    stageTransferAndSecondClaims();
    stageBobDeposit();
    stageSettle();
    stageRedeemPts();

    expect(claim(alice).result).toBeOk(Cl.uint(aliceFinal));
    expect(claim(bob).result).toBeOk(Cl.uint(bobFinal));

    const totalIn = aliceDeposit + bobDeposit;
    const totalOut = claim1 + claim2 * 2n + aliceFinal + bobFinal + alicePtOut + bobPtOut;
    const dust = totalIn - totalOut;
    expect(dust >= 0n && dust < 10n).toBe(true);
    expect(ststxBalance(vaultPrincipal)).toBeOk(Cl.uint(dust));
  });
});
