import {
  Runner,
  handler,
  HTTPCapability,
  EVMClient,
  HTTPClient,
  getNetwork,
  hexToBase64,
  bytesToHex,
  consensusIdenticalAggregation,
  type Runtime,
  type EVMLog,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { z } from "zod";
import {
  encodeAbiParameters,
  parseAbiParameters,
  decodeAbiParameters,
  keccak256,
  toBytes,
  type Address,
} from "viem";
import {
  buildGeminiRequest,
  type GeminiConfig,
  type GeminiSettlementResult,
} from "./gemini.js";



const configSchema = z.object({
  chainSelectorName: z.string(), // "ethereum-testnet-sepolia"
  marketAddress: z.string(),     // deployed contract address
  gasLimit: z.string(),          // "500000"
  publicKey: z.string(),         // authorized EVM address ("" = simulation only)
});

type Config = z.infer<typeof configSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// keccak256 of event signature — used as topics[0] filter in logTrigger
const SETTLEMENT_TOPIC = keccak256(toBytes("SettlementRequested(uint256,string)"));

// ─────────────────────────────────────────────────────────────────────────────
// Utility — hex string → base64 (required by CRE report API)
// ─────────────────────────────────────────────────────────────────────────────

function hexToBase64Payload(hex: `0x${string}`): string {
  return Buffer.from(hex.slice(2), "hex").toString("base64");
}


type CreateMarketBody = {
  question: string;
  durationHours: number;
  participants: string[];
};

const onHttpTrigger = (
  runtime: Runtime<Config>,
  // ✅ Fix [2]: SDK HTTP trigger payload type has `.input`, not `.body`
  payload: { input: Uint8Array }
): string => {
  runtime.log("[CreateMarket] HTTP trigger received");

  const bodyStr = new TextDecoder().decode(payload.input);
  const body = JSON.parse(bodyStr) as CreateMarketBody;
  const { question, durationHours, participants } = body;

  if (!question || !durationHours || !participants?.length) {
    throw new Error("Missing required fields: question, durationHours, participants");
  }

  const deadline = BigInt(
    Math.floor(runtime.now().getTime() / 1000) + durationHours * 3600
  );

  runtime.log(`[CreateMarket] "${question}" — deadline: ${deadline}`);

  // ABI-encode: instruction 0 = createMarket
  // Contract onReport must decode: (uint8 instr, string question, uint256 deadline, address[] participants)
  const callData = encodeAbiParameters(
    parseAbiParameters("uint8 instr, string question, uint256 deadline, address[] participants"),
    [0, question, deadline, participants as Address[]]
  );

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error(`Network not found: ${runtime.config.chainSelectorName}`);

  const evmClient = new EVMClient(network.chainSelector.selector);

  const signedReport = runtime
    .report({
      encodedPayload: hexToBase64Payload(callData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.marketAddress,
      report: signedReport,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();

  runtime.log(`[CreateMarket] ✅ TX status: ${writeResult.txStatus}`);
  return `Market created: "${question}"`;
};



const onLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  runtime.log(`[Settle] Log trigger — tx: ${bytesToHex(log.txHash)}`);

  if (log.topics.length < 2) {
    throw new Error("[Settle] Missing indexed topic (marketId)");
  }

  // topics[1] = marketId (indexed uint256, 32-byte padded)
  const marketId = BigInt(bytesToHex(log.topics[1]));

  // log.data = ABI-encoded non-indexed params: (string question)
  const [question] = decodeAbiParameters(
    parseAbiParameters("string question"),
    bytesToHex(log.data) as `0x${string}`
  ) as [string];

  runtime.log(`[Settle] Market ${marketId}: "${question}"`);


  const geminiKey = runtime.getSecret({ id: "GEMINI_API_KEY" }).result().value;
  const httpCapability = new HTTPClient();

  const geminiResult: GeminiSettlementResult = httpCapability
    .sendRequest(
      runtime,
      (sendRequester: HTTPSendRequester, cfg: GeminiConfig) =>
        buildGeminiRequest(sendRequester, cfg),
      consensusIdenticalAggregation<GeminiSettlementResult>()
    )({ apiKey: geminiKey, question } satisfies GeminiConfig)
    .result();

  runtime.log(
    `[Settle] Gemini: ${geminiResult.outcome} (${geminiResult.confidence}% confidence)`
  );
  runtime.log(`[Settle] Reasoning: ${geminiResult.reasoning}`);

  // ABI-encode: instruction 1 = settleMarket
  // Contract onReport must decode: (uint8 instr, uint256 marketId, uint8 outcome)
  const outcomeValue = geminiResult.outcome === "Yes" ? 0 : 1;

  const callData = encodeAbiParameters(
    parseAbiParameters("uint8 instr, uint256 marketId, uint8 outcome"),
    [1, marketId, outcomeValue]
  );

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error(`Network not found: ${runtime.config.chainSelectorName}`);

  const evmClient = new EVMClient(network.chainSelector.selector);

  const signedReport = runtime
    .report({
      encodedPayload: hexToBase64Payload(callData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.marketAddress,
      report: signedReport,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();

  runtime.log(
    `[Settle] ✅ ${writeResult.txStatus} — Market ${marketId} → ${geminiResult.outcome}`
  );
  return `Market ${marketId} settled: ${geminiResult.outcome}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// initWorkflow — register handlers
// ─────────────────────────────────────────────────────────────────────────────

function initWorkflow(config: Config) {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`);

  const evmClient = new EVMClient(network.chainSelector.selector);

  // HTTP trigger (empty authorizedKeys = simulation only)
  // Add { type: "KEY_TYPE_ECDSA_EVM", publicKey: "0x..." } before production deploy
  const httpTrigger = new HTTPCapability().trigger({
    authorizedKeys: config.publicKey
      ? [{ type: "KEY_TYPE_ECDSA_EVM", publicKey: config.publicKey }]
      : [],
  });

  // EVM log trigger — fires on SettlementRequested from the market contract
  const logTrigger = evmClient.logTrigger({
    addresses: [hexToBase64(config.marketAddress as `0x${string}`)],
    topics: [
      {
        values: [hexToBase64(SETTLEMENT_TOPIC)],
      },
    ],
  });

  return [
    handler(httpTrigger, onHttpTrigger),
    handler(logTrigger, onLogTrigger),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// main() — required CRE entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();