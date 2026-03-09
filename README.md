# 🔮 Mask Prediction — Chainlink CRE

> A privacy-preserving prediction market powered by a **commit–reveal scheme** and **Chainlink CRE (Compute Runtime Environment)** for AI-driven settlement.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-%5E0.8.0-363636?logo=solidity)](https://soliditylang.org/)
[![Chainlink](https://img.shields.io/badge/Chainlink-CRE-375BD2?logo=chainlink)](https://chain.link/)
[![Network](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io/)

Users can privately bet on real-world outcomes. Once the market deadline passes, a **Chainlink CRE workflow queries a Gemini AI oracle** to determine the factual outcome and settle the market on-chain — no trusted human arbiter needed.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Setup](#-setup)
- [Usage](#-usage)
  - [Deploy Contract](#1-deploy-the-smart-contract)
  - [Create a Market](#2-create-a-market)
  - [Place a Bet](#3-place-a-bet-commit-phase)
  - [Trigger Settlement](#4-trigger-market-settlement)
  - [AI Settlement via CRE](#5-ai-settlement-via-cre)
  - [Reveal Phase](#6-reveal-phase)
  - [Finalize & Claim](#7-finalize--claim-winnings)
- [Tenderly Testing](#-tenderly-virtual-testnet-optional)
- [Future Improvements](#-future-improvements)
- [License](#-license)

---

## 🧠 Overview

Prediction markets let users speculate on future real-world events. Traditional markets suffer from two core problems:

| Problem | Description |
|---|---|
| **Prediction leakage** | Users can see others' bets before committing |
| **Centralized resolution** | Outcomes rely on trusted human arbiters |

This project solves both using:

- 🔐 **Commit–Reveal cryptographic privacy** — bets are hashed until the reveal phase
- ⚙️ **Chainlink CRE decentralized compute** — trustless off-chain execution
- 🤖 **Gemini AI oracle settlement** — automated, verifiable outcome resolution

---

## ✨ Key Features

- **Private Betting** — Users submit hashed predictions; no one sees your bet until reveal
- **AI Oracle Settlement** — Market outcomes are resolved by Gemini AI via Chainlink CRE
- **Automated Resolution** — CRE detects the settlement event and submits results on-chain without manual intervention
- **Fair Reward Distribution** — Winners receive a proportional share of the losing pool

---

## 🏗️ Architecture

### System Flow

```
User
│
│  commitBet()
▼
Smart Contract (PrivatePredictionMarket)
│
│  SettlementRequested event
▼
Chainlink CRE Workflow
│
│  HTTP Capability
▼
Gemini AI Oracle
│
│  outcome + reasoning
▼
CRE Consensus
│
│  signed report
▼
Forwarder → Smart Contract Settlement
│
▼
Reveal Phase → Claim Rewards
```

### Workflow Lifecycle

```
HTTP Trigger → Create Market → User Commit Bets → Deadline Reached
                                                         │
                                               SettlementRequested Event
                                                         │
                                               CRE Log Trigger → Gemini AI Resolution
                                                         │
                                               Market Settled On-Chain
                                                         │
                                               Reveal Phase → Winner Claims Rewards
```

### Contract State Machine

```
Open ──commitBet()──▶ Resolving ──AI Oracle──▶ RevealPhase ──revealBet()──▶ Settled ──claim()──▶ Payout
```

---

## 📁 Project Structure

```
private-prediction-market/
├── contracts/
│   ├── PrivatePredictionMarket.sol
│   └── script/
│       └── Deploy.s.sol
├── workflow/
│   ├── src/
│   │   ├── workflow.ts          # CRE workflow (HTTP + Log triggers)
│   │   └── gemini.ts            # Gemini AI integration via HTTP capability
│   └── config.staging.json      # CRE network configuration
├── project.yaml                 # CRE project manifest
├── secrets.yaml                 # CRE secrets mapping
└── README.md
```

---

## ✅ Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | v20+ | [nodejs.org](https://nodejs.org) |
| Bun | v1.3+ | `curl -fsSL https://bun.sh/install \| bash` |
| CRE CLI | latest | [docs.chain.link/cre](https://docs.chain.link/cre/getting-started/cli-installation) |
| Foundry | latest | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |

---

## ⚙️ Setup

### 1. Install Dependencies

```bash
# Install Foundry libraries
cd contracts && forge install foundry-rs/forge-std --no-commit && cd ..

# Install workflow dependencies
cd workflow && bun install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
SEPOLIA_RPC_URL=
CRE_ETH_PRIVATE_KEY=
GEMINI_API_KEY=
```

### 3. Login to CRE

```bash
cre login
```

---

## 🚀 Usage

### 1. Deploy the Smart Contract

```bash
source .env
cd contracts

forge script script/Deploy.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $CRE_ETH_PRIVATE_KEY \
  --broadcast
```

Copy the deployed contract address and update `workflow/config.staging.json`:

```json
{
  "evms": [{ "marketAddress": "0xYOUR_DEPLOYED_ADDRESS" }]
}
```

---

### 2. Create a Market

Simulate the HTTP trigger to create a new prediction market:

```bash
cre workflow simulate workflow/ --broadcast
```

Select `1 → HTTP trigger` and enter a payload like:

```json
{
  "question": "Will ETH be above $5000 by June 1 2025?",
  "durationHours": 1,
  "participants": ["0xYOUR_ADDRESS"]
}
```

---

### 3. Place a Bet (Commit Phase)

**Generate your commitment hash:**

```bash
cast keccak $(cast abi-encode "f(uint8,bytes32,address)" \
  0 \
  0xDEADBEEF0000000000000000000000000000000000000000000000000000dead \
  0xYOUR_ADDRESS)
```

**Submit the bet:**

```bash
cast send $MARKET_ADDRESS \
  "commitBet(uint256,bytes32)" 0 0xYOUR_HASH \
  --value 0.01ether \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $CRE_ETH_PRIVATE_KEY
```

---

### 4. Trigger Market Settlement

After the market deadline passes, request settlement:

```bash
cast send $MARKET_ADDRESS \
  "requestSettlement(uint256)" 0 \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $CRE_ETH_PRIVATE_KEY
```

> Save the transaction hash — you'll need it for the CRE log trigger.

---

### 5. AI Settlement via CRE

```bash
cre workflow simulate workflow/ --broadcast
```

Select `2 → Log trigger` and provide:

```
txHash: <your transaction hash>
eventIndex: 0
```

The CRE workflow will automatically:
1. Detect the `SettlementRequested` event
2. Query Gemini AI for the outcome
3. Submit the signed result on-chain

---

### 6. Reveal Phase

Reveal your original bet to verify it against your commitment:

```bash
cast send $MARKET_ADDRESS \
  "revealBet(uint256,uint8,bytes32)" \
  0 0 0xDEADBEEF... \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $CRE_ETH_PRIVATE_KEY
```

---

### 7. Finalize & Claim Winnings

**Finalize the reveal phase (admin, after 24 hours):**

```bash
cast send $MARKET_ADDRESS \
  "finalizeRevealPhase(uint256)" 0 \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $CRE_ETH_PRIVATE_KEY
```

**Claim your rewards:**

```bash
cast send $MARKET_ADDRESS \
  "claim(uint256)" 0 \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $CRE_ETH_PRIVATE_KEY
```

Winning participants receive a proportional share of the losing pool. 🎉

---

## 🧪 Tenderly Virtual TestNet (Optional)

Tenderly enables advanced testing with **time manipulation** and **unlimited test ETH**.

### 1. Create a Virtual TestNet

Visit [dashboard.tenderly.co](https://dashboard.tenderly.co), create a **Sepolia fork**, and copy the RPC URL.

### 2. Update `.env`

```env
TENDERLY_RPC_URL=https://virtual.sepolia.rpc.tenderly.co/YOUR_VNET_ID
```

### 3. Deploy to Tenderly

```bash
source .env
cd contracts

forge script script/Deploy.s.sol \
  --rpc-url $TENDERLY_RPC_URL \
  --private-key $CRE_ETH_PRIVATE_KEY \
  --broadcast
```

### 4. Update CRE Configuration

```json
{
  "evms": [{
    "id": "evm:tenderly-sepolia",
    "chainId": 11155111,
    "marketAddress": "0xTENDERLY_DEPLOYED_ADDRESS",
    "rpc": "https://virtual.sepolia.rpc.tenderly.co/YOUR_VNET_ID"
  }]
}
```

### 5. Advance Blockchain Time

Fast-forward time to bypass market deadlines during testing (e.g., advance 2 hours):

```bash
curl -X POST $TENDERLY_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_increaseTime","params":[7200],"id":1}'
```

Then repeat **steps 2–7** using `$TENDERLY_RPC_URL`.

---

## 🔭 Future Improvements

- [ ] Multi-AI oracle consensus (Gemini + Perplexity + GPT-4)
- [ ] Web frontend for placing and viewing bets
- [ ] Automated reveal phase finalization
- [ ] Cross-chain prediction markets
- [ ] Enhanced privacy using TEEs (Trusted Execution Environments)

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.