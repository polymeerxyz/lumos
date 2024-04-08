import { Cell, Script, config, hd, Indexer, RPC, CellDep } from "@ckb-lumos/lumos";
import { bytes, BytesLike, Uint128 } from "@ckb-lumos/lumos/codec";
import { common } from "@ckb-lumos/lumos/common-scripts";
import { ScriptConfig } from "@ckb-lumos/lumos/config";
import {
  addCellDep,
  encodeToAddress,
  minimalCellCapacityCompatible,
  sealTransaction,
  TransactionSkeleton,
} from "@ckb-lumos/lumos/helpers";
import { computeScriptHash } from "@ckb-lumos/lumos/utils";

config.initializeConfig(config.TESTNET);

// https://blog.cryptape.com/enhance-sudts-programmability-with-xudt#heading-conclusion
const XUDT: ScriptConfig = {
  CODE_HASH: "0x25c29dc317811a6f6f3985a7a9ebc4838bd388d19d0feeecf0bcd60f6c0975bb",
  HASH_TYPE: "type",
  TX_HASH: "0xbf6fb538763efec2a70a6a3dcb7242787087e1030c4e7d86585bc63a9d337f5f",
  INDEX: "0x0",
  DEP_TYPE: "code",
};

const indexer = new Indexer("https://testnet.ckb.dev");
const rpc = new RPC("https://testnet.ckb.dev");

const ownerPrivateKey = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const owner = createScript(config.TESTNET.SCRIPTS.SECP256K1_BLAKE160, hd.key.privateKeyToBlake160(ownerPrivateKey));
const ownerAddress = encodeToAddress(owner);
const xudt = createScript(XUDT, computeScriptHash(owner));

// call this method to mint xUDT for test purpose first before transferring
// will mint 10000 xUDT to owner self
async function mint() {
  const mintAmount = 10000;
  const mintCell: Cell = {
    cellOutput: { lock: owner, type: xudt, capacity: "0x0" },
    data: bytes.hexify(Uint128.pack(mintAmount)),
  };
  const xudtCapacity = minimalCellCapacityCompatible(mintCell).toHexString();
  mintCell.cellOutput.capacity = xudtCapacity;

  const txSkeleton = TransactionSkeleton({
    cellProvider: { collector: (query) => indexer.collector({ type: "empty", data: "0x", ...query }) },
  }).asMutable();

  addCellDep(txSkeleton, createCellDep(XUDT));

  await common.injectCapacity(txSkeleton, [ownerAddress], xudtCapacity);

  txSkeleton.update("outputs", (outputs) => outputs.push(mintCell));
  await common.payFeeByFeeRate(txSkeleton, [ownerAddress], 1000);
  common.prepareSigningEntries(txSkeleton);

  const signatures = txSkeleton
    .get("signingEntries")
    .map(({ message }) => hd.key.signRecoverable(message, ownerPrivateKey))
    .toArray();

  const signed = sealTransaction(txSkeleton, signatures);
  const txHash = await rpc.sendTransaction(signed);
  console.log(`https://pudge.explorer.nervos.org/transaction/${txHash}`);
}

// transfer the first collected xUDT cell to Alice
async function transfer() {
  const alicePrivateKey = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const aliceLock = createScript(
    config.TESTNET.SCRIPTS.SECP256K1_BLAKE160,
    hd.key.privateKeyToBlake160(alicePrivateKey)
  );

  // collector to collect xUDTs owned by the owner
  const xudtCollector = indexer.collector({ type: xudt, lock: owner });

  let transferCell: Cell | undefined;

  for await (const cell of xudtCollector.collect()) {
    transferCell = cell;
    // collect only one
    break;
  }

  if (!transferCell) {
    throw new Error("Owner do not have an xUDT cell yet, please call mint first");
  }

  const transferAmount = Uint128.unpack(bytes.bytify(transferCell.data).slice(0, 16));
  console.log("Transfer to Alice", transferAmount.toNumber(), "xUDT");

  // mutable txSkeleton, suggest using it without any mutation
  const txSkeleton = TransactionSkeleton({
    cellProvider: { collector: (query) => indexer.collector({ type: "empty", data: "0x", ...query }) },
  }).asMutable();

  addCellDep(txSkeleton, createCellDep(XUDT));

  await common.setupInputCell(txSkeleton, transferCell);
  txSkeleton.update("outputs", (outputs) =>
    outputs.update(0, (cell) => ({ ...cell!, cellOutput: { ...cell!.cellOutput, lock: aliceLock } }))
  );

  await common.payFeeByFeeRate(txSkeleton, [ownerAddress], 1000);
  common.prepareSigningEntries(txSkeleton);

  const signatures = txSkeleton
    .get("signingEntries")
    .map(({ message }) => hd.key.signRecoverable(message, ownerPrivateKey))
    .toArray();

  const signed = sealTransaction(txSkeleton, signatures);
  const txHash = await rpc.sendTransaction(signed);
  console.log(txHash);
}

// uncomment the next line to mint token first
// mint();

// uncomment the next line to transfer the minted token
// transfer();

function createScript(config: ScriptConfig, args: BytesLike): Script {
  return { codeHash: config.CODE_HASH, hashType: config.HASH_TYPE, args: bytes.hexify(args) };
}

function createCellDep(config: ScriptConfig): CellDep {
  return { depType: config.DEP_TYPE, outPoint: { txHash: config.TX_HASH, index: config.INDEX } };
}
