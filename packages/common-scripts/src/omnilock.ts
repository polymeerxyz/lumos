import { Options, TransactionSkeletonType } from "@ckb-lumos/helpers";
import { bytes, BytesLike } from "@ckb-lumos/codec";
import {
  blockchain,
  Cell,
  CellCollector as CellCollectorType,
  CellProvider,
  HexString,
  OutPoint,
  PackedSince,
  QueryOptions,
  Script,
  values,
  WitnessArgs,
} from "@ckb-lumos/base";
import { Config, getConfig } from "@ckb-lumos/config-manager";
import {
  addCellDep,
  isOmnilockScript,
  prepareSigningEntries as _prepareSigningEntries,
} from "./helper";
import { FromInfo } from ".";
import { parseFromInfo } from "./from_info";
import { CellCollectorConstructor } from "./type";
import {
  byteOf,
  byteVecOf,
  option,
  table,
  vector,
} from "@ckb-lumos/codec/lib/molecule";
import {
  BytesOpt,
  createFixedHexBytesCodec,
} from "@ckb-lumos/codec/lib/blockchain";
import { bytify, hexify } from "@ckb-lumos/codec/lib/bytes";
import * as bitcoin from "./omnilock-bitcoin";
import * as solana from "./omnilock-solana";
import { decode as bs58Decode } from "bs58";
import { ckbHash } from "@ckb-lumos/base/lib/utils";

const { ScriptValue } = values;

export type OmnilockInfo = {
  auth: OmnilockAuth;
};

export type OmnilockAuth =
  | IdentityCkb
  | IdentityEthereum
  | IdentityBitcoin
  | IdentitySolana;

export type IdentityCkb = {
  flag: "SECP256K1_BLAKE160";
  /**
   * the blake160 hash of a secp256k1 public key
   */
  content: BytesLike;
};
export type IdentityEthereum = {
  flag: "ETHEREUM";

  /**
   * an Ethereum address, aka the public key hash
   */
  content: BytesLike;
};
export type IdentityBitcoin = {
  flag: "BITCOIN";
  /**
   * a Bitcoin address, such as
   * `P2PKH(17VZNX1SN5NtKa8UQFxwQbFeFc3iqRYhem)`,
   * `P2SH(3EktnHQD7RiAE6uzMj2ZifT9YgRrkSgzQX)`,
   * `Bech32(bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4)`
   */
  content: string;
};

export type IdentitySolana = {
  flag: "SOLANA";
  // base58 encoded ed25519 public key
  content: string;
};

// https://github.com/XuJiandong/omnilock/blob/4e9fdb6ca78637651c8145bb7c5b82b4591332fb/c/ckb_identity.h#L62-L76
enum IdentityFlagsType {
  IdentityFlagsCkb = 0,
  IdentityFlagsEthereum = 1,
  IdentityFlagsEos = 2,
  IdentityFlagsTron = 3,
  IdentityFlagsBitcoin = 4,
  IdentityFlagsDogecoin = 5,
  IdentityCkbMultisig = 6,
  IdentityFlagsEthereumDisplaying = 18,
  IdentityFlagsSolana = 19,
  IdentityFlagsOwnerLock = 0xfc,
  IdentityFlagsExec = 0xfd,
  IdentityFlagsDl = 0xfe,
}

// https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0042-omnilock/0042-omnilock.md#authentication
const OMNILOCK_AUTH_CONTENT_LENGTH = 20;

const SECP256K1_SIGNATURE_PLACEHOLDER_LENGTH = 65;

//  https://datatracker.ietf.org/doc/html/rfc8032#section-7.1
// 64 bytes for ED25519 signature
// 32 bytes for Ed25519 pubkey public key
const ED25519_SIGNATURE_PLACEHOLDER_LENGTH = 96;

/**
 * Create an Omnilock script based on other networks' wallet
 * @deprecated please migrate to {@link createSimplePublicKeyBasedOmnilockScript}
 * @see https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0042-omnilock/0042-omnilock.md
 * @param omnilockInfo
 * @param options
 * @returns
 * @example
 * // create an omnilock to work with MetaMask wallet
 * createOmnilockScript({
 *   auth: {
 *     flag: "ETHEREUM",
 *     content: "an ethereum address here",
 *   }, { config })
 * // or we can create an omnilock to work with UniSat wallet
 * createOmnilockScript({
 *   auth: {
 *     flag: "BITCOIN",
 *     content: "a bitcoin address here",
 *   }
 * }, {config})
 */
export function createOmnilockScript(
  omnilockInfo: OmnilockInfo,
  options?: Options
): Script {
  const config = options?.config || getConfig();
  const omnilockConfig = config.SCRIPTS.OMNILOCK;

  if (!omnilockConfig) {
    throw new Error("OMNILOCK script config not found.");
  }

  const defaultOmnilockArgs = 0b00000000;
  const omnilockArgs = [defaultOmnilockArgs];

  if (omnilockInfo.auth.flag === "BITCOIN") {
    return {
      codeHash: omnilockConfig.CODE_HASH,
      hashType: omnilockConfig.HASH_TYPE,
      args: bytes.hexify(
        bytes.concat(
          [IdentityFlagsType.IdentityFlagsBitcoin],
          bitcoin.decodeAddress(omnilockInfo.auth.content),
          omnilockArgs
        )
      ),
    };
  }

  return createSimplePublicKeyBasedOmnilockScript(omnilockInfo, options);
}

/**
 * Create an Omnilock script based on other networks' wallet
 * @see https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0042-omnilock/0042-omnilock.md
 * @param omnilockInfo
 * @param options
 * @returns
 * @example
 * // create an omnilock to work with MetaMask wallet
 * createOmnilockScript({
 *   auth: {
 *     flag: "ETHEREUM",
 *     content: "an ethereum address here",
 *   }, { config })
 * // or we can create an omnilock to work with UniSat wallet
 * createOmnilockScript({
 *   auth: {
 *     flag: "BITCOIN",
 *     content: "a bitcoin address here",
 *   }
 * }, {config})
 */
export function createSimplePublicKeyBasedOmnilockScript(
  omnilockInfo: OmnilockInfo,
  options?: Options
): Script {
  const config = options?.config || getConfig();
  const omnilockConfig = config.SCRIPTS.OMNILOCK;
  if (!omnilockConfig) {
    throw new Error("OMNILOCK script config not found.");
  }

  // TODO The advanced feature will be supported in the future.
  // https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0042-omnilock/0042-omnilock.md
  /**
   * |Name                 |Flags     |Affected Args              |Affected Args Size (byte)|Affected Witness|
   * |---------------------|----------|---------------------------|-------------------------|----------------|
   * |administrator mode   |0b00000001|AdminList cell Type ID     |32                       |omni_identity/signature in OmniLockWitnessLock|
   * |anyone-can-pay mode  |0b00000010|minimum ckb/udt in ACP     |2                        |N/A             |
   * |time-lock mode       |0b00000100|since for timelock         |8                        |N/A             |
   * |supply mode          |0b00001000|type script hash for supply|32                       |N/A             |
   */
  const defaultOmnilockArgs = 0b00000000;
  const omnilockArgs = [defaultOmnilockArgs];

  const args = (() => {
    const flag = omnilockInfo.auth.flag;
    switch (flag) {
      case "ETHEREUM":
        return bytes.hexify(
          bytes.concat(
            [IdentityFlagsType.IdentityFlagsEthereum],
            omnilockInfo.auth.content,
            omnilockArgs
          )
        );
      case "SECP256K1_BLAKE160":
        return bytes.hexify(
          bytes.concat(
            [IdentityFlagsType.IdentityFlagsCkb],
            omnilockInfo.auth.content,
            omnilockArgs
          )
        );
      case "BITCOIN":
        return bytes.hexify(
          bytes.concat(
            [IdentityFlagsType.IdentityFlagsBitcoin],
            bitcoin.parseAddressToPublicKeyHash(omnilockInfo.auth.content),
            omnilockArgs
          )
        );
      case "SOLANA": {
        const authContent = bytes
          .bytify(ckbHash(bs58Decode(omnilockInfo.auth.content)))
          .slice(0, OMNILOCK_AUTH_CONTENT_LENGTH);
        return bytes.hexify(
          bytes.concat(
            [IdentityFlagsType.IdentityFlagsSolana],
            authContent,
            omnilockArgs
          )
        );
      }

      default:
        throw new Error(`Not supported flag: ${flag}.`);
    }
  })();

  return {
    codeHash: omnilockConfig.CODE_HASH,
    hashType: omnilockConfig.HASH_TYPE,
    args,
  };
}

const Hexify = { pack: bytify, unpack: hexify };

// https://github.com/cryptape/omnilock/blob/cd764d7133ec4e6b192fac4b93fc0596ef5b71f6/c/omni_lock.mol#L3
// array Auth[byte; 21];
const IDENTITY_LENGTH = 21;
const Auth = createFixedHexBytesCodec(IDENTITY_LENGTH);
const SmtProof = byteVecOf(Hexify);
const SmtProofEntry = table(
  {
    mask: byteOf(Hexify),
    proof: SmtProof,
  },
  ["mask", "proof"]
);
const SmtProofEntryVec = vector(SmtProofEntry);
const OmniIdentity = table(
  {
    identity: Auth,
    proofs: SmtProofEntryVec,
  },
  ["identity", "proofs"]
);
const OmniIdentityOpt = option(OmniIdentity);
export const OmnilockWitnessLock = table(
  {
    signature: BytesOpt,
    omni_identity: OmniIdentityOpt,
    preimage: BytesOpt,
  },
  ["signature", "omni_identity", "preimage"]
);

export const CellCollector: CellCollectorConstructor = class CellCollector
  implements CellCollectorType
{
  private cellCollector: CellCollectorType;
  private config: Config;
  public readonly fromScript: Script;

  constructor(
    fromInfo: FromInfo,
    cellProvider: CellProvider,
    {
      config = undefined,
      queryOptions = {},
    }: Options & {
      queryOptions?: QueryOptions;
    } = {}
  ) {
    if (!cellProvider) {
      throw new Error(`Cell provider is missing!`);
    }
    config = config || getConfig();
    this.fromScript = parseFromInfo(fromInfo, { config }).fromScript;

    this.config = config;

    queryOptions = {
      ...queryOptions,
      lock: this.fromScript,
      type: queryOptions.type || "empty",
    };

    this.cellCollector = cellProvider.collector(queryOptions);
  }

  async *collect(): AsyncGenerator<Cell> {
    if (!isOmnilockScript(this.fromScript, this.config)) {
      return;
    }

    for await (const inputCell of this.cellCollector.collect()) {
      yield inputCell;
    }
  }
};

/**
 * Setup input cell infos, such as cell deps and witnesses.
 *
 * @param txSkeleton
 * @param inputCell
 * @param _fromInfo
 * @param options
 */
export async function setupInputCell(
  txSkeleton: TransactionSkeletonType,
  inputCell: Cell,
  _fromInfo?: FromInfo,
  {
    config = undefined,
    defaultWitness = "0x",
    since = undefined,
  }: Options & {
    defaultWitness?: HexString;
    since?: PackedSince;
  } = {}
): Promise<TransactionSkeletonType> {
  config = config || getConfig();

  const fromScript = inputCell.cellOutput.lock;
  if (!isOmnilockScript(fromScript, config)) {
    throw new Error(`Not OMNILOCK input!`);
  }

  // add inputCell to txSkeleton
  txSkeleton = txSkeleton.update("inputs", (inputs) => {
    return inputs.push(inputCell);
  });

  const output: Cell = {
    cellOutput: {
      capacity: inputCell.cellOutput.capacity,
      lock: inputCell.cellOutput.lock,
      type: inputCell.cellOutput.type,
    },
    data: inputCell.data,
  };

  txSkeleton = txSkeleton.update("outputs", (outputs) => {
    return outputs.push(output);
  });

  if (since) {
    txSkeleton = txSkeleton.update("inputSinces", (inputSinces) => {
      return inputSinces.set(txSkeleton.get("inputs").size - 1, since);
    });
  }

  txSkeleton = txSkeleton.update("witnesses", (witnesses) => {
    return witnesses.push(defaultWitness);
  });

  const template = config.SCRIPTS.OMNILOCK;
  const secp256k1Template = config.SCRIPTS.SECP256K1_BLAKE160;
  if (!template) {
    throw new Error(`OMNILOCK script not defined in config!`);
  }
  if (!secp256k1Template) {
    throw new Error(`SECP256K1_BLAKE160 script not defined in config!`);
  }

  const omnilockOutPoint: OutPoint = {
    txHash: template.TX_HASH,
    index: template.INDEX,
  };
  const secp256k1OutPoint: OutPoint = {
    txHash: secp256k1Template.TX_HASH,
    index: secp256k1Template.INDEX,
  };

  // add cell dep
  txSkeleton = addCellDep(txSkeleton, {
    outPoint: omnilockOutPoint,
    depType: template.DEP_TYPE,
  });
  txSkeleton = addCellDep(txSkeleton, {
    outPoint: secp256k1OutPoint,
    depType: secp256k1Template.DEP_TYPE,
  });

  // add witness
  /*
   * Modify the skeleton, so the first witness of the fromAddress script group
   * has a WitnessArgs construct with 85-byte zero filled values. While this
   * is not required, it helps in transaction fee estimation.
   */
  const firstIndex = txSkeleton
    .get("inputs")
    .findIndex((input) =>
      new ScriptValue(input.cellOutput.lock, { validate: false }).equals(
        new ScriptValue(fromScript, { validate: false })
      )
    );
  if (firstIndex !== -1) {
    while (firstIndex >= txSkeleton.get("witnesses").size) {
      txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
        witnesses.push("0x")
      );
    }
    let witness: string = txSkeleton.get("witnesses").get(firstIndex)!;

    const placeholderLength = (() => {
      const identityFlag = bytes.bytify(inputCell.cellOutput.lock.args)[0];
      switch (identityFlag) {
        case IdentityFlagsType.IdentityFlagsSolana: {
          return ED25519_SIGNATURE_PLACEHOLDER_LENGTH;
        }

        case IdentityFlagsType.IdentityFlagsCkb:
        case IdentityFlagsType.IdentityFlagsEthereum:
        case IdentityFlagsType.IdentityFlagsBitcoin: {
          return SECP256K1_SIGNATURE_PLACEHOLDER_LENGTH;
        }

        default: {
          throw new Error(
            `Unsupported flag: ${identityFlag}, please check if the script.args is expected`
          );
        }
      }
    })();

    const newWitnessArgs: WitnessArgs = {
      lock: createWitnessLockPlaceholder(placeholderLength),
    };

    witness = bytes.hexify(blockchain.WitnessArgs.pack(newWitnessArgs));
    txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
      witnesses.set(firstIndex, witness)
    );
  }

  return txSkeleton;
}

function createWitnessLockPlaceholder(signatureLength: number) {
  const serializedLength = OmnilockWitnessLock.pack({
    signature: new Uint8Array(signatureLength),
  }).byteLength;

  return bytes.hexify(new Uint8Array(serializedLength));
}

/**
 * prepare for txSkeleton signingEntries, will update txSkeleton.get("signingEntries")
 *
 * @param txSkeleton
 * @param options
 */
export function prepareSigningEntries(
  txSkeleton: TransactionSkeletonType,
  { config = undefined }: Options = {}
): TransactionSkeletonType {
  config = config || getConfig();

  return _prepareSigningEntries(txSkeleton, config, "OMNILOCK");
}

export { bitcoin };
export { solana };

export default {
  prepareSigningEntries,
  setupInputCell,
  CellCollector,
  OmnilockWitnessLock,
  createOmnilockScript,
  createSimplePublicKeyBasedOmnilockScript,
};
