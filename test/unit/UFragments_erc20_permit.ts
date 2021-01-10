import { ethers, upgrades } from 'hardhat'
import { Contract, Signer, Wallet, BigNumber } from 'ethers'
import { expect } from 'chai'

import {
  sign,
  EIP712_DOMAIN_TYPEHASH,
  PERMIT_TYPEHASH,
  getPermitDigest,
  getDomainSeparator,
} from '../utils/signatures'

const ETHEREUM_CHAIN_ID = 1
const ETHEREUM_AMPL_ADDRESS = '0xD46bA6D942050d489DBd938a2C909A5d5039A161'
const EIP712_REVISION = '1'

const TOKEN_NAME = 'Ampleforth'

let accounts: Signer[],
  deployer: Signer,
  deployerAddress: string,
  owner: Wallet,
  ownerAddress: string,
  spender: Wallet,
  spenderAddress: string,
  uFragments: Contract,
  initialSupply: BigNumber

async function setupContracts() {
  // prepare signers
  accounts = await ethers.getSigners()
  deployer = accounts[0]
  deployerAddress = await deployer.getAddress()

  owner = Wallet.createRandom()
  ownerAddress = await owner.getAddress()

  spender = Wallet.createRandom()
  spenderAddress = await spender.getAddress()

  // deploy upgradable token
  const factory = await ethers.getContractFactory('UFragments')
  uFragments = await upgrades.deployProxy(factory, [deployerAddress], {
    initializer: 'initialize(address)',
  })
  // fetch initial supply
  initialSupply = await uFragments.totalSupply()
}

// https://eips.ethereum.org/EIPS/eip-2612
describe('UFragments:Initialization', () => {
  before('setup UFragments contract', setupContracts)

  it('should set the EIP2612 parameters', async function () {
    expect(await uFragments.EIP712_REVISION()).to.eq('0x31')
    expect(await uFragments.EIP712_DOMAIN()).to.eq(EIP712_DOMAIN_TYPEHASH)
    expect(await uFragments.PERMIT_TYPEHASH()).to.eq(PERMIT_TYPEHASH)
    // with hard-coded parameters
    expect(await uFragments.DOMAIN_SEPARATOR()).to.eq(
      getDomainSeparator(
        EIP712_REVISION,
        TOKEN_NAME,
        ETHEREUM_AMPL_ADDRESS,
        ETHEREUM_CHAIN_ID,
      ),
    )
  })

  it('initial nonce is 0', async function () {
    expect(await uFragments.nonces(deployerAddress)).to.eq('0')
    expect(await uFragments.nonces(ownerAddress)).to.eq('0')
    expect(await uFragments.nonces(spenderAddress)).to.eq('0')
  })
})

// Using the cases specified by:
// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/test/drafts/ERC20Permit.test.js
describe('UFragments:EIP-2612 Permit', () => {
  const MAX_DEADLINE = BigNumber.from(2).pow(256).sub(1)

  beforeEach('setup UFragments contract', setupContracts)

  describe('permit', function () {
    const signPermission = async (
      signer: Wallet,
      owner: string,
      spender: string,
      value: number,
      nonce: number,
      deadline: BigNumber,
    ) => {
      const digest = getPermitDigest(
        EIP712_REVISION,
        TOKEN_NAME,
        ETHEREUM_AMPL_ADDRESS,
        ETHEREUM_CHAIN_ID,
        owner,
        spender,
        value,
        nonce,
        deadline,
      )

      return sign(digest, signer.privateKey)
    }

    it('accepts owner signature', async function () {
      const { v, r, s } = await signPermission(
        owner,
        ownerAddress,
        spenderAddress,
        123,
        0,
        MAX_DEADLINE,
      )
      await expect(
        uFragments
          .connect(deployer)
          .permit(ownerAddress, spenderAddress, 123, MAX_DEADLINE, v, r, s),
      )
        .to.emit(uFragments, 'Approval')
        .withArgs(ownerAddress, spenderAddress, '123')
      expect(await uFragments.nonces(ownerAddress)).to.eq('1')
      expect(await uFragments.allowance(ownerAddress, spenderAddress)).to.eq(
        '123',
      )
    })

    it('rejects reused signature', async function () {
      const { v, r, s } = await signPermission(
        owner,
        ownerAddress,
        spenderAddress,
        123,
        0,
        MAX_DEADLINE,
      )
      await uFragments
        .connect(deployer)
        .permit(ownerAddress, spenderAddress, 123, MAX_DEADLINE, v, r, s)
      await expect(
        uFragments
          .connect(deployer)
          .permit(ownerAddress, spenderAddress, 123, MAX_DEADLINE, v, r, s),
      ).to.be.reverted
    })

    it('rejects other signature', async function () {
      const { v, r, s } = await signPermission(
        spender,
        ownerAddress,
        spenderAddress,
        123,
        0,
        MAX_DEADLINE,
      )
      await expect(
        uFragments
          .connect(deployer)
          .permit(ownerAddress, spenderAddress, 123, MAX_DEADLINE, v, r, s),
      ).to.be.reverted
    })

    it('rejects expired permit', async function () {
      const currentTs = (await ethers.provider.getBlock('latest')).timestamp
      const olderTs = currentTs - 3600 * 24 * 7
      const deadline = BigNumber.from(olderTs)
      const { v, r, s } = await signPermission(
        owner,
        ownerAddress,
        spenderAddress,
        123,
        0,
        deadline,
      )
      await expect(
        uFragments
          .connect(deployer)
          .permit(ownerAddress, spenderAddress, 123, deadline, v, r, s),
      ).to.be.reverted
    })
  })
})
