import { beforeEach, describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// Authorization and validation guards. Simnet resets between tests, so
// each test wires and initializes only what it needs.

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const alice = accounts.get("wallet_1")!;

const vaultPrincipal = `${deployer}.cyclesplit-vault`;
const ststx = Cl.contractPrincipal(deployer, "mock-ststx-token");
const rateSource = Cl.contractPrincipal(deployer, "mock-rate-source");
const wrongToken = Cl.contractPrincipal(deployer, "pt-ststx"); // valid SIP-010, wrong principal
const wrongSource = Cl.contractPrincipal(deployer, "mock-rate-source-2"); // valid trait, wrong principal

const fund = () => {
  simnet.callPublicFn("mock-ststx-token", "mint", [Cl.uint(1_000_000_000n), Cl.principal(alice)], deployer);
  simnet.callPublicFn("mock-rate-source", "set-ratio", [Cl.uint(1_100_000n)], deployer);
};

const wire = () => {
  simnet.callPublicFn("pt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer);
  simnet.callPublicFn("yt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer);
};

const init = () => {
  const maturity = BigInt(simnet.burnBlockHeight) + 100n;
  simnet.callPublicFn("cyclesplit-vault", "initialize", [ststx, rateSource, Cl.uint(maturity)], deployer);
};

beforeEach(fund);

describe("cyclesplit guards", () => {
  it("only the deployer can wire the vault into the tokens, once", () => {
    expect(
      simnet.callPublicFn("pt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], alice).result
    ).toBeErr(Cl.uint(200));
    expect(
      simnet.callPublicFn("yt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], alice).result
    ).toBeErr(Cl.uint(210));

    expect(
      simnet.callPublicFn("pt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer).result
    ).toBeOk(Cl.bool(true));
    expect(
      simnet.callPublicFn("yt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callPublicFn("pt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer).result
    ).toBeErr(Cl.uint(201));
    expect(
      simnet.callPublicFn("yt-ststx", "set-vault", [Cl.principal(vaultPrincipal)], deployer).result
    ).toBeErr(Cl.uint(211));
  });

  it("rejects vault operations before initialization", () => {
    wire();
    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "deposit",
        [Cl.uint(1_000_000n), ststx, rateSource],
        alice
      ).result
    ).toBeErr(Cl.uint(302));
    expect(simnet.callPublicFn("cyclesplit-vault", "sync", [rateSource], alice).result).toBeErr(
      Cl.uint(302)
    );
  });

  it("only the deployer can initialize, with a future maturity, once", () => {
    wire();
    const maturity = BigInt(simnet.burnBlockHeight) + 100n;
    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "initialize",
        [ststx, rateSource, Cl.uint(maturity)],
        alice
      ).result
    ).toBeErr(Cl.uint(300));
    expect(
      simnet.callPublicFn("cyclesplit-vault", "initialize", [ststx, rateSource, Cl.uint(0)], deployer)
        .result
    ).toBeErr(Cl.uint(311));
    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "initialize",
        [ststx, rateSource, Cl.uint(maturity)],
        deployer
      ).result
    ).toBeOk(Cl.bool(true));
    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "initialize",
        [ststx, rateSource, Cl.uint(maturity)],
        deployer
      ).result
    ).toBeErr(Cl.uint(301));
  });

  it("blocks direct mint/burn/index access on PT and YT", () => {
    wire();
    expect(
      simnet.callPublicFn("pt-ststx", "mint", [Cl.uint(1n), Cl.principal(alice)], alice).result
    ).toBeErr(Cl.uint(200));
    expect(
      simnet.callPublicFn("pt-ststx", "burn", [Cl.uint(1n), Cl.principal(alice)], deployer).result
    ).toBeErr(Cl.uint(200));
    expect(
      simnet.callPublicFn("yt-ststx", "mint", [Cl.uint(1n), Cl.principal(alice)], alice).result
    ).toBeErr(Cl.uint(210));
    expect(
      simnet.callPublicFn("yt-ststx", "update-index", [Cl.uint(1n)], deployer).result
    ).toBeErr(Cl.uint(210));
    expect(
      simnet.callPublicFn("yt-ststx", "take-accrued", [Cl.principal(alice)], alice).result
    ).toBeErr(Cl.uint(210));
  });

  it("rejects unknown tokens, unknown rate sources, and zero amounts", () => {
    wire();
    init();
    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "deposit",
        [Cl.uint(1_000_000n), wrongToken, rateSource],
        alice
      ).result
    ).toBeErr(Cl.uint(304));
    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "deposit",
        [Cl.uint(1_000_000n), ststx, wrongSource],
        alice
      ).result
    ).toBeErr(Cl.uint(303));
    expect(
      simnet.callPublicFn("cyclesplit-vault", "deposit", [Cl.uint(0), ststx, rateSource], alice)
        .result
    ).toBeErr(Cl.uint(305));
  });

  it("blocks PT redemption before settlement and empty yield claims", () => {
    wire();
    init();
    expect(
      simnet.callPublicFn("cyclesplit-vault", "redeem-pt", [Cl.uint(1_000_000n), ststx], alice)
        .result
    ).toBeErr(Cl.uint(309));
    expect(
      simnet.callPublicFn("cyclesplit-vault", "claim-yield", [ststx, rateSource], alice).result
    ).toBeErr(Cl.uint(310));
    expect(
      simnet.callPublicFn("cyclesplit-vault", "settle-maturity", [rateSource], alice).result
    ).toBeErr(Cl.uint(307));
  });

  it("redeem-pair returns the underlying principal before maturity", () => {
    wire();
    init();
    const deposit = 10_000_000n; // 10 stSTX at 1.10 -> 11_000_000 units
    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "deposit",
        [Cl.uint(deposit), ststx, rateSource],
        alice
      ).result
    ).toBeOk(Cl.uint(11_000_000n));

    expect(
      simnet.callPublicFn(
        "cyclesplit-vault",
        "redeem-pair",
        [Cl.uint(11_000_000n), ststx, rateSource],
        alice
      ).result
    ).toBeOk(Cl.uint(deposit));

    expect(
      simnet.callReadOnlyFn("pt-ststx", "get-balance", [Cl.principal(alice)], alice).result
    ).toBeOk(Cl.uint(0));
    expect(
      simnet.callReadOnlyFn("yt-ststx", "get-balance", [Cl.principal(alice)], alice).result
    ).toBeOk(Cl.uint(0));
    expect(
      simnet.callReadOnlyFn("mock-ststx-token", "get-balance", [Cl.principal(alice)], alice).result
    ).toBeOk(Cl.uint(1_000_000_000n));
  });
});
