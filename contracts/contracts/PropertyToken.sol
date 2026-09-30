// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PropertyToken
/// @notice One contract = one property. Each token is one share of that property.
///
/// Who can do what:
///  - BrickShare (PLATFORM_ROLE): adds verified (KYC) investors to the whitelist.
///  - Land Authority (LAND_AUTHORITY_ROLE): approves the property, and can freeze it.
///  - Anyone on the whitelist: can hold and transfer shares.
///
/// Life of a property:
///  1. Deployed in "Pending" state. No shares exist yet.
///  2. Land Authority checks the papers and calls approveProperty().
///     All shares are then minted to the property owner.
///  3. Whitelisted investors can buy/sell shares (transfers).
///  4. If there is a legal dispute, the Land Authority can freeze() it.
///     While frozen, no shares can move at all.
contract PropertyToken is ERC20, AccessControl {
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");
    bytes32 public constant LAND_AUTHORITY_ROLE = keccak256("LAND_AUTHORITY_ROLE");

    enum Status {
        Pending,
        Approved
    }

    string public propertyId; // BrickShare's id for the property, e.g. "BLR-WHITEFIELD-001"
    string public documentHash; // IPFS hash (CID) of the property papers
    address public immutable propertyOwner;
    uint256 public immutable totalShares;

    Status public status;
    bool public frozen;
    string public freezeReason;

    mapping(address => bool) public isWhitelisted;

    event PropertyApproved(address indexed by, uint256 totalShares);
    event Whitelisted(address indexed investor);
    event RemovedFromWhitelist(address indexed investor);
    event Frozen(address indexed by, string reason);
    event Unfrozen(address indexed by);

    error NotApproved();
    error AlreadyApproved();
    error PropertyFrozen(string reason);
    error NotWhitelisted(address account);
    error ZeroAddress();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory propertyId_,
        string memory documentHash_,
        uint256 totalShares_,
        address propertyOwner_,
        address platform_,
        address landAuthority_
    ) ERC20(name_, symbol_) {
        if (propertyOwner_ == address(0) || platform_ == address(0) || landAuthority_ == address(0)) {
            revert ZeroAddress();
        }
        propertyId = propertyId_;
        documentHash = documentHash_;
        totalShares = totalShares_;
        propertyOwner = propertyOwner_;

        _grantRole(DEFAULT_ADMIN_ROLE, platform_);
        _grantRole(PLATFORM_ROLE, platform_);
        _grantRole(LAND_AUTHORITY_ROLE, landAuthority_);

        // The owner is verified as part of listing, so they can hold shares.
        isWhitelisted[propertyOwner_] = true;
        emit Whitelisted(propertyOwner_);
    }

    /// Shares are whole numbers: you can't own half a share.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    // ---------- Land Authority ----------

    function approveProperty() external onlyRole(LAND_AUTHORITY_ROLE) {
        if (status == Status.Approved) revert AlreadyApproved();
        status = Status.Approved;
        _mint(propertyOwner, totalShares);
        emit PropertyApproved(msg.sender, totalShares);
    }

    function freeze(string calldata reason) external onlyRole(LAND_AUTHORITY_ROLE) {
        frozen = true;
        freezeReason = reason;
        emit Frozen(msg.sender, reason);
    }

    function unfreeze() external onlyRole(LAND_AUTHORITY_ROLE) {
        frozen = false;
        freezeReason = "";
        emit Unfrozen(msg.sender);
    }

    // ---------- BrickShare (KYC) ----------

    function addToWhitelist(address investor) external onlyRole(PLATFORM_ROLE) {
        if (investor == address(0)) revert ZeroAddress();
        isWhitelisted[investor] = true;
        emit Whitelisted(investor);
    }

    function removeFromWhitelist(address investor) external onlyRole(PLATFORM_ROLE) {
        isWhitelisted[investor] = false;
        emit RemovedFromWhitelist(investor);
    }

    // ---------- Rules checked on every share movement ----------

    /// OpenZeppelin calls this for every mint and transfer.
    function _update(address from, address to, uint256 value) internal override {
        if (frozen) revert PropertyFrozen(freezeReason);
        if (from != address(0)) {
            // A normal transfer (not the first mint).
            if (status != Status.Approved) revert NotApproved();
            if (!isWhitelisted[from]) revert NotWhitelisted(from);
        }
        if (!isWhitelisted[to]) revert NotWhitelisted(to);
        super._update(from, to, value);
    }
}
