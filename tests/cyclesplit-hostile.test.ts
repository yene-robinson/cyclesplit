import { beforeEach, describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// Adversarial suite. Models the June 2025 ALEX Protocol exploit, in which a
// fake token carrying a malicious transfer function was accepted by a protocol
// that took arbitrary tokens, and then used to drain pooled funds.
//
// The vault takes <sip-010-token> and <rate-source> as call parameters, so it
// has the same surface. The defence is that both are pinned to a single
// principal at initialize. These tests assert not just that hostile contracts
// are rejected, but that their code is never reached at all.

const ERR_INVALID_RATE_SOURCE = 303;
const ERR_INVALID_TOKEN = 304;

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const alice = accounts.get("wallet_1")!;

const vaultPrincipal = `${deployer}.cyclesplit-vault`;
const ststx = Cl.contractPrincipal(deployer, "mock-ststx-token");
const rateSource = Cl.contractPrincipal(deployer, "mock-rate-source");
const hostileToken = Cl.contractPrincipal(deployer, "mock-hostile-token");
const hostileSource = Cl.contractPrincipal(deployer, "mock-hostile-rate-source");

const RATIO = 1_100_000n;

const wire = () => {
  simnet.callPublicFn("pt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer);
  simnet.callPublicFn("yt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer);
  simnet.callPublicFn("mock-rate-source", "set-ratio", [Cl.uint(RATIO)], deployer);
};

const init = (token = ststx) => {
  const maturity = BigInt(simnet.burnBlockHeight) + 100n;
  return simnet.callPublicFn(
    "cyclesplit-vault",
    "initialize",
    [token, rateSource, Cl.uint(maturity)],
    deployer
  );
};

const transferCalls = () =>
  simnet.callReadOnlyFn("mock-hostile-token", "get-transfer-calls", [], deployer).result;
const reentryAttempts = () =>
  simnet.callReadOnlyFn("mock-hostile-token", "get-reentry-attempts", [], deployer).result;
const ratioCalls = () =>
  simnet.callReadOnlyFn("mock-hostile-rate-source", "get-calls", [], deployer).result;

beforeEach(() => {
  wire();
  simnet.callPublicFn("mock-ststx-token", "mint", [Cl.uint(1_000_000_000n), Cl.principal(alice)], deployer);
  simnet.callPublicFn("mock-hostile-token", "mint", [Cl.uint(1_000_000_000n), Cl.principal(alice)], deployer);
});

describe("hostile contracts (ALEX-class attack)", () => {
  it("deposit rejects a hostile token and never executes its code", () => {
    init();
    // Configure it to silently steal: report success without moving funds.
    simnet.callPublicFn("mock-hostile-token", "set-lie", [Cl.bool(true)], deployer);

    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "deposit",
        [Cl.uint(10_000_000n), hostileToken, rateSource],
        alice
      ).result
    ).toBeErr(Cl.uint(ERR_INVALID_TOKEN));

    // The attacker's transfer was never invoked.
    expect(transferCalls()).toBeUint(0);
    expect(reentryAttempts()).toBeUint(0);
    // And nothing was minted against it.
    expect(simnet.callReadOnlyFn("pt-ststx", "get-total-supply", [], deployer).result).toBeOk(Cl.uint(0));
    expect(simnet.callReadOnlyFn("yt-ststx", "get-total-supply", [], deployer).result).toBeOk(Cl.uint(0));
  });

  it("redeem-pair and claim-yield reject a hostile token without executing it", () => {
    init();
    simnet.callPublicFn(
      "cyclesplit-vault",
      "deposit",
      [Cl.uint(10_000_000n), ststx, rateSource],
      alice
    );

    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "redeem-pair",
        [Cl.uint(1_000_000n), hostileToken, rateSource],
        alice
      ).result
    ).toBeErr(Cl.uint(ERR_INVALID_TOKEN));

    expect(
      simnet.callPublicFn("cyclesplit-vault", "claim-yield", [hostileToken, rateSource], alice).result
    ).toBeErr(Cl.uint(ERR_INVALID_TOKEN));

    expect(transferCalls()).toBeUint(0);
    // The real position is untouched.
    expect(
      simnet.callReadOnlyFn("pt-ststx", "get-balance", [Cl.principal(alice)], alice).result
    ).toBeOk(Cl.uint(11_000_000n));
  });

  it("sync, deposit and settle-maturity reject a hostile rate source without calling it", () => {
    init();

    expect(
      simnet.callPublicFn("cyclesplit-vault", "sync", [hostileSource], alice).result
    ).toBeErr(Cl.uint(ERR_INVALID_RATE_SOURCE));

    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "deposit",
        [Cl.uint(10_000_000n), ststx, hostileSource],
        alice
      ).result
    ).toBeErr(Cl.uint(ERR_INVALID_RATE_SOURCE));

    simnet.mineEmptyBurnBlocks(120);
    expect(
      simnet.callPublicFn("cyclesplit-vault", "settle-maturity", [hostileSource], alice).result
    ).toBeErr(Cl.uint(ERR_INVALID_RATE_SOURCE));

    // The absurd ratio was never read, so it could never reach the mint math.
    expect(ratioCalls()).toBeUint(0);
  });

  it("a re-entrant token configured as the vault asset cannot corrupt accounting", () => {
    // Deliberately point the vault at the attacker to exercise the reentrancy
    // path itself, rather than the principal guard.
    init(hostileToken);

    const deposit = 10_000_000n;
    const units = (deposit * RATIO) / 1_000_000n;

    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "deposit",
        [Cl.uint(deposit), hostileToken, rateSource],
        alice
      ).result
    ).toBeOk(Cl.uint(units));

    // The attacker did re-enter the vault mid-transfer.
    expect(reentryAttempts()).toBeUint(1);

    // Accounting is still exact: the vault holds the deposit and minted
    // precisely the matching units of each token.
    expect(
      simnet.callReadOnlyFn("mock-hostile-token", "get-balance", [Cl.principal(vaultPrincipal)], deployer).result
    ).toBeOk(Cl.uint(deposit));
    expect(simnet.callReadOnlyFn("pt-ststx", "get-total-supply", [], deployer).result).toBeOk(Cl.uint(units));
    expect(simnet.callReadOnlyFn("yt-ststx", "get-total-supply", [], deployer).result).toBeOk(Cl.uint(units));
  });
});
