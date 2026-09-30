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
  });
});
