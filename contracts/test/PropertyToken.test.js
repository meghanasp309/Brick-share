const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PropertyToken", function () {
  let token, platform, landAuthority, owner, alice, bob;
  const SHARES = 10_000n;

  beforeEach(async function () {
    [platform, landAuthority, owner, alice, bob] = await ethers.getSigners();
    const PropertyToken = await ethers.getContractFactory("PropertyToken");
    token = await PropertyToken.deploy(
      "Whitefield Villa Shares",
      "WFV",
      "BLR-WHITEFIELD-001",
      "ipfs://demo-hash",
      SHARES,
      owner.address,
      platform.address,
      landAuthority.address
    );
  });

  it("pending properties pay no rent", async function () {
    await expect(token.connect(platform).distributeRent(100n, "rent-1")).to.be.revertedWithCustomError(
      token,
      "NotApproved"
    );
  });

  it("starts pending, with no shares", async function () {
    expect(await token.status()).to.equal(0); // Pending
    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.decimals()).to.equal(0);
  });

  it("only the Land Authority can approve, and approval mints all shares to the owner", async function () {
    await expect(token.connect(platform).approveProperty()).to.be.revertedWithCustomError(
      token,
      "AccessControlUnauthorizedAccount"
    );
    await expect(token.connect(landAuthority).approveProperty())
      .to.emit(token, "PropertyApproved")
      .withArgs(landAuthority.address, SHARES);
    expect(await token.balanceOf(owner.address)).to.equal(SHARES);
    await expect(token.connect(landAuthority).approveProperty()).to.be.revertedWithCustomError(
      token,
      "AlreadyApproved"
    );
  });

  it("can be frozen while pending, and then cannot be approved until unfrozen", async function () {
    await expect(token.connect(landAuthority).freeze("Papers look fake"))
      .to.emit(token, "Frozen")
      .withArgs(landAuthority.address, "Papers look fake");
    await expect(token.connect(landAuthority).approveProperty())
      .to.be.revertedWithCustomError(token, "PropertyFrozen")
      .withArgs("Papers look fake");
    expect(await token.status()).to.equal(0); // still Pending
    expect(await token.totalSupply()).to.equal(0n);

    await token.connect(landAuthority).unfreeze();
    await token.connect(landAuthority).approveProperty();
    expect(await token.balanceOf(owner.address)).to.equal(SHARES);
  });

  describe("after approval", function () {
    beforeEach(async function () {
      await token.connect(landAuthority).approveProperty();
    });

    it("blocks transfers to investors who are not KYC-whitelisted", async function () {
      await expect(token.connect(owner).transfer(alice.address, 50))
        .to.be.revertedWithCustomError(token, "NotWhitelisted")
        .withArgs(alice.address);
    });

    it("allows transfers between whitelisted investors", async function () {
      await token.connect(platform).addToWhitelist(alice.address);
      await token.connect(platform).addToWhitelist(bob.address);
      await token.connect(owner).transfer(alice.address, 50);
      await token.connect(alice).transfer(bob.address, 20);
      expect(await token.balanceOf(alice.address)).to.equal(30n);
      expect(await token.balanceOf(bob.address)).to.equal(20n);
    });

    it("only BrickShare can whitelist", async function () {
      await expect(token.connect(alice).addToWhitelist(alice.address)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("blocks a removed investor from sending shares", async function () {
      await token.connect(platform).addToWhitelist(alice.address);
      await token.connect(owner).transfer(alice.address, 50);
      await token.connect(platform).removeFromWhitelist(alice.address);
      await expect(token.connect(alice).transfer(owner.address, 10))
        .to.be.revertedWithCustomError(token, "NotWhitelisted")
        .withArgs(alice.address);
    });

    it("freeze blocks every transfer until unfreeze", async function () {
      await token.connect(platform).addToWhitelist(alice.address);
      await expect(token.connect(landAuthority).freeze("Legal dispute"))
        .to.emit(token, "Frozen")
        .withArgs(landAuthority.address, "Legal dispute");
      await expect(token.connect(owner).transfer(alice.address, 50))
        .to.be.revertedWithCustomError(token, "PropertyFrozen")
        .withArgs("Legal dispute");

      await token.connect(landAuthority).unfreeze();
      await token.connect(owner).transfer(alice.address, 50);
      expect(await token.balanceOf(alice.address)).to.equal(50n);
    });

    it("even BrickShare cannot freeze or unfreeze", async function () {
      await expect(token.connect(platform).freeze("x")).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount"
      );
      await token.connect(landAuthority).freeze("x");
      await expect(token.connect(platform).unfreeze()).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount"
      );
    });

    describe("rent payouts", function () {
      beforeEach(async function () {
        await token.connect(platform).addToWhitelist(alice.address);
        await token.connect(platform).addToWhitelist(bob.address);
        await token.connect(owner).transfer(alice.address, 2_000); // 20%
        await token.connect(owner).transfer(bob.address, 500); // 5%
      });

      it("splits rent by the shares held at the moment it is paid", async function () {
        await expect(token.connect(platform).distributeRent(1_00_000_00n, "rent-1")) // ₹1,00,000
          .to.emit(token, "RentDistributed")
          .withArgs(1n, 1n, 1_00_000_00n, "rent-1");

        // Moving shares after the payout does not change who gets it.
        await token.connect(alice).transfer(bob.address, 1_000);
        expect(await token.rentOwed(1, alice.address)).to.equal(20_000_00n);
        expect(await token.rentOwed(1, bob.address)).to.equal(5_000_00n);
        expect(await token.rentOwed(1, owner.address)).to.equal(75_000_00n);

        // The next payout sees the new balances.
        await token.connect(platform).distributeRent(1_000_00n, "rent-2");
        expect(await token.rentOwed(2, alice.address)).to.equal(100_00n);
        expect(await token.rentOwed(2, bob.address)).to.equal(150_00n);
        expect(await token.balanceOfAt(alice.address, 1)).to.equal(2_000n);
        expect(await token.balanceOfAt(alice.address, 2)).to.equal(1_000n);
        expect(await token.payoutCount()).to.equal(2n);
        expect((await token.payout(2)).ref).to.equal("rent-2");
        expect(await token.payoutIdByRef("rent-2")).to.equal(2n);
      });

      it("never pays the same rent twice, and only BrickShare can pay", async function () {
        await token.connect(platform).distributeRent(100n, "rent-1");
        await expect(token.connect(platform).distributeRent(100n, "rent-1"))
          .to.be.revertedWithCustomError(token, "DuplicatePayout")
          .withArgs("rent-1");
        await expect(token.connect(owner).distributeRent(100n, "rent-2")).to.be.revertedWithCustomError(
          token,
          "AccessControlUnauthorizedAccount"
        );
        await expect(token.connect(platform).distributeRent(0n, "rent-3")).to.be.revertedWithCustomError(
          token,
          "ZeroAmount"
        );
        await expect(token.rentOwed(9, alice.address)).to.be.revertedWithCustomError(token, "UnknownPayout");
      });

      it("a frozen property pays no rent", async function () {
        await token.connect(landAuthority).freeze("Legal dispute");
        await expect(token.connect(platform).distributeRent(100n, "rent-1"))
          .to.be.revertedWithCustomError(token, "PropertyFrozen")
          .withArgs("Legal dispute");
        await token.connect(landAuthority).unfreeze();
        await token.connect(platform).distributeRent(100n, "rent-1");
      });
    });

    it("keeps IPFS fingerprints of property papers", async function () {
      await expect(token.connect(platform).addDocument("bafy-deed", "sale-deed"))
        .to.emit(token, "DocumentAdded")
        .withArgs(0n, "bafy-deed", "sale-deed");
      expect(await token.documentCount()).to.equal(1n);
      expect((await token.document(0)).cid).to.equal("bafy-deed");
      await expect(token.connect(owner).addDocument("x", "y")).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount"
      );
    });
  });
});
