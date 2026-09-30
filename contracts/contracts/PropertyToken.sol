// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

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
///     While frozen, no shares can move at all, and no rent is paid.
///  5. Each month BrickShare records a rent payout (distributeRent). The
///     contract takes a "snapshot" of who held how many shares at that
///     moment, and says how much of the rent each holder gets.
///  6. Property papers live on IPFS. Their fingerprints (CIDs) are kept here,
///     so anyone can check the papers were never changed.
contract PropertyToken is ERC20, AccessControl {
    using Checkpoints for Checkpoints.Trace208;

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

    // ---------- Rent ----------

    /// One rent payout. Amounts are in paise (1 rupee = 100 paise). The rupees
    /// themselves move in the app's wallet; the chain keeps the record.
    struct RentPayout {
        uint256 amountPaise;
        uint256 snapshotId; // share balances are read at this snapshot
        uint64 paidAt;
        string ref; // BrickShare's id for the payout, e.g. "rent-12"
    }

    RentPayout[] private _payouts; // payout id = index + 1
    mapping(string => uint256) public payoutIdByRef; // 0 = no payout with this ref yet

    // Every balance change is saved against the next snapshot id, so we can
    // look up what anyone held at any past snapshot.
    uint256 public snapshotCount;
    mapping(address => Checkpoints.Trace208) private _balanceHistory;

    // ---------- Documents on IPFS ----------

    struct Document {
        string cid; // IPFS fingerprint of the file
        string kind; // e.g. "sale-deed", "rent-agreement"
        uint64 addedAt;
    }

    Document[] private _documents;

    event PropertyApproved(address indexed by, uint256 totalShares);
    event Whitelisted(address indexed investor);
    event RemovedFromWhitelist(address indexed investor);
    event Frozen(address indexed by, string reason);
    event Unfrozen(address indexed by);
    event RentDistributed(uint256 indexed payoutId, uint256 snapshotId, uint256 amountPaise, string ref);
    event DocumentAdded(uint256 indexed index, string cid, string kind);

    error NotApproved();
    error AlreadyApproved();
    error PropertyFrozen(string reason);
    error NotWhitelisted(address account);
    error ZeroAddress();
    error ZeroAmount();
    error EmptyValue();
    error DuplicatePayout(string ref);
    error UnknownPayout(uint256 payoutId);
    error UnknownSnapshot(uint256 snapshotId);

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

    // ---------- BrickShare (rent) ----------

    /// Records a rent payout of `amountPaise` for everyone holding shares right
    /// now. Each holder gets (their shares / all shares) of it: see rentOwed().
    /// `ref` must be new, so the same rent can never be paid twice.
    function distributeRent(uint256 amountPaise, string calldata ref)
        external
        onlyRole(PLATFORM_ROLE)
        returns (uint256 payoutId)
    {
        if (frozen) revert PropertyFrozen(freezeReason);
        if (status != Status.Approved) revert NotApproved();
        if (amountPaise == 0) revert ZeroAmount();
        if (bytes(ref).length == 0) revert EmptyValue();
        if (payoutIdByRef[ref] != 0) revert DuplicatePayout(ref);

        uint256 snapshotId = ++snapshotCount;
        _payouts.push(RentPayout(amountPaise, snapshotId, uint64(block.timestamp), ref));
        payoutId = _payouts.length;
        payoutIdByRef[ref] = payoutId;
        emit RentDistributed(payoutId, snapshotId, amountPaise, ref);
    }

    function payoutCount() external view returns (uint256) {
        return _payouts.length;
    }

    function payout(uint256 payoutId) public view returns (RentPayout memory) {
        if (payoutId == 0 || payoutId > _payouts.length) revert UnknownPayout(payoutId);
        return _payouts[payoutId - 1];
    }

    /// How many shares `account` held when snapshot `snapshotId` was taken.
    function balanceOfAt(address account, uint256 snapshotId) public view returns (uint256) {
        if (snapshotId == 0 || snapshotId > snapshotCount) revert UnknownSnapshot(snapshotId);
        return _balanceHistory[account].upperLookupRecent(uint48(snapshotId));
    }

    /// The part of a payout that belongs to `account`, in paise (rounded down).
    function rentOwed(uint256 payoutId, address account) external view returns (uint256) {
        RentPayout memory p = payout(payoutId);
        return (p.amountPaise * balanceOfAt(account, p.snapshotId)) / totalShares;
    }

    // ---------- BrickShare (documents) ----------

    /// Saves the IPFS fingerprint of a new property paper.
    function addDocument(string calldata cid, string calldata kind) external onlyRole(PLATFORM_ROLE) {
        if (bytes(cid).length == 0 || bytes(kind).length == 0) revert EmptyValue();
        _documents.push(Document(cid, kind, uint64(block.timestamp)));
        emit DocumentAdded(_documents.length - 1, cid, kind);
    }

    function documentCount() external view returns (uint256) {
        return _documents.length;
    }

    function document(uint256 index) external view returns (Document memory) {
        return _documents[index];
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

        // Remember the new balances for rent snapshots.
        uint48 key = uint48(snapshotCount + 1);
        if (from != address(0)) _balanceHistory[from].push(key, uint208(balanceOf(from)));
        _balanceHistory[to].push(key, uint208(balanceOf(to)));
    }
}
