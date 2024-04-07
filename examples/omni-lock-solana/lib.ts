import { BI, helpers, Indexer, RPC, config, commons } from "@ckb-lumos/lumos";
import { common, omnilock } from "@ckb-lumos/lumos/common-scripts";
import { blockchain, bytify, hexify } from "@ckb-lumos/lumos/codec";
import { Config } from "@ckb-lumos/lumos/config";

const CKB_RPC_URL = "https://testnet.ckb.dev";
const rpc = new RPC(CKB_RPC_URL);
const indexer = new Indexer(CKB_RPC_URL);

export const CONFIG: Config = {
  PREFIX: config.TESTNET.PREFIX,
  SCRIPTS: {
    ...config.TESTNET.SCRIPTS,
    // TODO remove it when the testnet omnilock is updated
    OMNILOCK: {
      TX_HASH: "0x042485f2b1386f3156a1585de6fe38e3c866ffb5acbcea6cab61a37b9780e7b1",
      HASH_TYPE: "type",
      CODE_HASH: "0xc039461134d79c87929eca28cb89261ec3f66cc2b5f562063da863330870598b",
      DEP_TYPE: "code",
      INDEX: "0x0",
    },
  },
};

config.initializeConfig(CONFIG);

declare global {
  interface Window {
    phantom: {
      solana: omnilock.solana.Provider;
    };
  }
}

export const solana = window.phantom.solana;

export function asyncSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Options {
  from: string;
  to: string;
  amount: string;
}

export async function transfer(options: Options): Promise<string> {
  let txSkeleton = helpers.TransactionSkeleton({ cellProvider: indexer });

  txSkeleton = await common.transfer(txSkeleton, [options.from], options.to, options.amount);
  txSkeleton = await common.payFeeByFeeRate(txSkeleton, [options.from], 1000);
  txSkeleton = commons.omnilock.prepareSigningEntries(txSkeleton);

  const signedMessage = await omnilock.solana.signMessage(
    txSkeleton.signingEntries.get(0)!.message,
    window.phantom.solana
  );

  const signedWitness = hexify(
    blockchain.WitnessArgs.pack({
      lock: commons.omnilock.OmnilockWitnessLock.pack({ signature: bytify(signedMessage) }),
    })
  );

  txSkeleton = txSkeleton.update("witnesses", (witnesses) => witnesses.set(0, signedWitness));

  const signedTx = helpers.createTransactionFromSkeleton(txSkeleton);
  const txHash = await rpc.sendTransaction(signedTx, "passthrough");

  return txHash;
}

export async function capacityOf(address: string): Promise<BI> {
  const collector = indexer.collector({
    lock: helpers.parseAddress(address),
  });

  let balance = BI.from(0);
  for await (const cell of collector.collect()) {
    balance = balance.add(cell.cellOutput.capacity);
  }

  return balance;
}
