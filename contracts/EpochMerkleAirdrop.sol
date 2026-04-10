// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title EpochMerkleAirdrop
/// @notice Distributes an ERC20 token across Merkle-based airdrop epochs with owner-managed deadlines.
/// @dev
/// Each epoch stores its own Merkle root, deadline, and claimed bitmap so claim state is isolated
/// between distributions. The contract must be funded ahead of claims through normal ERC20
/// transfers, and uses SafeERC20 for token movements.
contract EpochMerkleAirdrop is Ownable2Step {
    using SafeERC20 for IERC20;

    /// @notice Thrown when a required address argument is the zero address.
    error ZeroAddress();

    /// @notice Thrown when attempting to create an epoch with an empty Merkle root.
    error InvalidMerkleRoot();

    /// @notice Thrown when an epoch deadline is not strictly in the future.
    error InvalidDeadline();

    /// @notice Thrown when a claim references an epoch that has not been created.
    /// @param epoch The epoch id that was requested.
    error EpochNotStarted(uint256 epoch);

    /// @notice Thrown when a claim is submitted for an index that was already consumed.
    /// @param epoch The epoch containing the claimed index.
    /// @param index The Merkle leaf index that was already claimed.
    error AlreadyClaimed(uint256 epoch, uint256 index);

    /// @notice Thrown when the supplied Merkle proof does not match the claim payload.
    error InvalidProof();

    /// @notice Thrown when a claim is submitted at or after the epoch deadline.
    /// @param epoch The epoch being claimed from.
    /// @param deadline The cutoff timestamp configured for the epoch.
    error ClaimWindowClosed(uint256 epoch, uint256 deadline);

    /// @notice Thrown when attempting to recover the primary airdrop token via the generic recovery path.
    error InvalidRecoverToken();

    /// @notice Emitted when a new airdrop epoch is created.
    /// @param epoch The newly assigned epoch id.
    /// @param merkleRoot The root used to validate claims for the epoch.
    /// @param deadline The timestamp after which claims for the epoch are blocked.
    event AirdropStarted(uint256 indexed epoch, bytes32 indexed merkleRoot, uint256 deadline);

    /// @notice Emitted when the owner changes an epoch deadline.
    /// @param epoch The epoch whose deadline changed.
    /// @param previousDeadline The deadline value before the update.
    /// @param newDeadline The deadline value after the update.
    event DeadlineUpdated(uint256 indexed epoch, uint256 previousDeadline, uint256 newDeadline);

    /// @notice Emitted when a claim succeeds.
    /// @param epoch The epoch that was claimed from.
    /// @param index The Merkle leaf index consumed by the claim.
    /// @param account The recipient account that received the tokens.
    /// @param amount The token amount transferred to the recipient.
    event Claimed(uint256 indexed epoch, uint256 indexed index, address indexed account, uint256 amount);

    /// @notice Emitted when the owner withdraws unclaimed airdrop tokens.
    /// @param to The recipient of the withdrawn tokens.
    /// @param amount The token amount withdrawn.
    event Withdrawn(address indexed to, uint256 amount);

    /// @notice Emitted when the owner recovers an unrelated ERC20 token from the contract.
    /// @param erc20 The recovered token address.
    /// @param to The recipient of the recovered tokens.
    /// @param amount The token amount recovered.
    event RecoveredERC20(address indexed erc20, address indexed to, uint256 amount);

    /// @notice ERC20 token distributed by this airdrop contract.
    IERC20 public immutable token;

    /// @notice Most recently created epoch id. Starts at zero before any airdrop is configured.
    uint256 public currentEpoch;

    /// @notice Merkle root used to validate claims for each epoch.
    mapping(uint256 epoch => bytes32 merkleRoot) public merkleRoots;

    /// @notice Claim deadline timestamp for each epoch.
    mapping(uint256 epoch => uint256 deadline) public deadlines;

    /// @notice Total amount successfully claimed from each epoch.
    mapping(uint256 epoch => uint256 claimedAmount) public epochClaimedAmounts;

    /// @dev Packed claim status bitmap for each epoch, keyed by 256-bit word index.
    mapping(uint256 epoch => mapping(uint256 wordIndex => uint256 claimedWord)) private claimedBitMap;

    /// @notice Deploys the airdrop contract.
    /// @param _token The ERC20 token to distribute across all epochs.
    constructor(address _token) Ownable(msg.sender) {
        if (_token == address(0)) revert ZeroAddress();
        token = IERC20(_token);
    }

    /// @notice Creates the next airdrop epoch with its own root and deadline.
    /// @dev Epoch ids are strictly sequential and start at 1.
    /// @param newRoot The Merkle root for the new epoch.
    /// @param deadline The timestamp before which claims must be submitted.
    function startNewAirdrop(bytes32 newRoot, uint256 deadline) external onlyOwner {
        if (newRoot == bytes32(0)) revert InvalidMerkleRoot();
        _validateFutureDeadline(deadline);

        uint256 nextEpoch = currentEpoch + 1;
        currentEpoch = nextEpoch;
        merkleRoots[nextEpoch] = newRoot;
        deadlines[nextEpoch] = deadline;

        emit AirdropStarted(nextEpoch, newRoot, deadline);
    }

    /// @notice Updates the deadline for an existing epoch.
    /// @dev
    /// A deadline of zero disables the epoch immediately. Any non-zero deadline must still be in the future
    /// relative to the current block timestamp.
    /// @param epoch The epoch whose deadline should be updated.
    /// @param newDeadline The replacement deadline, or zero to disable claims for the epoch.
    function setEpochDeadline(uint256 epoch, uint256 newDeadline) external onlyOwner {
        if (merkleRoots[epoch] == bytes32(0)) revert EpochNotStarted(epoch);
        if (newDeadline != 0) {
            _validateFutureDeadline(newDeadline);
        }

        uint256 previousDeadline = deadlines[epoch];
        deadlines[epoch] = newDeadline;

        emit DeadlineUpdated(epoch, previousDeadline, newDeadline);
    }

    /// @notice Claims tokens for a Merkle leaf in a specific epoch.
    /// @dev
    /// Anyone may submit a valid claim transaction, but tokens are always transferred to `account`.
    /// The leaf format must match `_leaf(index, account, amount)`.
    /// @param epoch The epoch to claim from.
    /// @param index The Merkle leaf index assigned to the claim.
    /// @param account The recipient encoded in the Merkle leaf.
    /// @param amount The token amount encoded in the Merkle leaf.
    /// @param merkleProof The Merkle proof showing the leaf belongs to the epoch root.
    function claim(
        uint256 epoch,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external {
        bytes32 merkleRoot = merkleRoots[epoch];
        if (merkleRoot == bytes32(0)) revert EpochNotStarted(epoch);

        uint256 deadline = deadlines[epoch];
        if (block.timestamp >= deadline) revert ClaimWindowClosed(epoch, deadline);
        if (isClaimed(epoch, index)) revert AlreadyClaimed(epoch, index);

        bytes32 node = _leaf(index, account, amount);
        if (!MerkleProof.verifyCalldata(merkleProof, merkleRoot, node)) revert InvalidProof();

        _setClaimed(epoch, index);
        token.safeTransfer(account, amount);
        epochClaimedAmounts[epoch] += amount;

        emit Claimed(epoch, index, account, amount);
    }

    /// @notice Returns the stored metadata for an epoch.
    /// @param epoch The epoch to inspect.
    /// @return merkleRoot The Merkle root assigned to the epoch.
    /// @return deadline The claim deadline assigned to the epoch.
    /// @return claimedAmount The amount successfully claimed from the epoch so far.
    function epochInfo(
        uint256 epoch
    ) external view returns (bytes32 merkleRoot, uint256 deadline, uint256 claimedAmount) {
        return (merkleRoots[epoch], deadlines[epoch], epochClaimedAmounts[epoch]);
    }

    /// @notice Returns whether a claim index has already been used for an epoch.
    /// @param epoch The epoch to inspect.
    /// @param index The Merkle leaf index to inspect.
    /// @return True if the claim index has already been consumed, otherwise false.
    function isClaimed(uint256 epoch, uint256 index) public view returns (bool) {
        uint256 wordIndex = index / 256;
        uint256 bitIndex = index % 256;
        uint256 claimedWord = claimedBitMap[epoch][wordIndex];
        uint256 mask = 1 << bitIndex;

        return claimedWord & mask == mask;
    }

    /// @notice Withdraws airdrop tokens held by the contract.
    /// @param to The recipient of the withdrawn tokens.
    /// @param amount The amount of the airdrop token to withdraw.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();

        token.safeTransfer(to, amount);

        emit Withdrawn(to, amount);
    }

    /// @notice Recovers an ERC20 token other than the primary airdrop token.
    /// @param erc20 The ERC20 token to recover.
    /// @param to The recipient of the recovered tokens.
    /// @param amount The amount to recover.
    function recoverERC20(address erc20, address to, uint256 amount) external onlyOwner {
        if (erc20 == address(token)) revert InvalidRecoverToken();
        if (erc20 == address(0) || to == address(0)) revert ZeroAddress();

        IERC20(erc20).safeTransfer(to, amount);

        emit RecoveredERC20(erc20, to, amount);
    }

    /// @dev Marks a Merkle leaf index as claimed in the packed bitmap for an epoch.
    /// @param epoch The epoch containing the claim.
    /// @param index The Merkle leaf index to mark as claimed.
    function _setClaimed(uint256 epoch, uint256 index) internal {
        uint256 wordIndex = index / 256;
        uint256 bitIndex = index % 256;

        claimedBitMap[epoch][wordIndex] |= 1 << bitIndex;
    }

    /// @dev Validates that a deadline is in the future.
    /// @param deadline The candidate deadline to validate.
    function _validateFutureDeadline(uint256 deadline) internal view {
        if (deadline <= block.timestamp) revert InvalidDeadline();
    }

    /// @dev Computes the leaf hash expected by this contract for Merkle verification.
    /// @param index The Merkle leaf index.
    /// @param account The recipient account encoded in the leaf.
    /// @param amount The token amount encoded in the leaf.
    /// @return The leaf hash compatible with OpenZeppelin StandardMerkleTree.
    function _leaf(uint256 index, address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
    }
}
