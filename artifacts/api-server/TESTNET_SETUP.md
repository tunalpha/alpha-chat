# Testnet Setup — Polygon Amoy USDT

Guida per configurare l'ambiente Polygon Amoy prima di eseguire il testnet E2E.

## 1. Wallet con Amoy POL

Il wallet `GAS_STATION_PRIVATE_KEY` deve avere Amoy POL (almeno 0.1 POL consigliati).

**Faucet Polygon:**
- https://faucet.polygon.technology/
- Selezionare "Polygon PoS (Amoy)"
- Inserire l'indirizzo del gas station wallet

Per trovare l'indirizzo:
```bash
node -e "
const { privateKeyToAccount } = require('viem/accounts');
const pk = process.env.GAS_STATION_PRIVATE_KEY;
const acc = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
console.log('Address:', acc.address);
"
```

Verificare il saldo su: https://www.oklink.com/amoy/address/<address>

---

## 2. Deploy Mock USDT su Amoy

### Opzione A — Remix IDE (raccomandato, no installazioni)

1. Aprire https://remix.ethereum.org/
2. Creare nuovo file `MockUSDT.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * MockUSDT — ERC-20 con mint() senza restrizioni per testnet.
 * 6 decimali come il vero USDT.
 * NON usare su mainnet.
 */
contract MockUSDT {
    string  public constant name     = "Mock USDT";
    string  public constant symbol   = "USDT";
    uint8   public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /** Mint senza restrizioni — solo testnet */
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
    }
}
```

3. In Remix: **Solidity Compiler** → versione `0.8.20` → **Compile MockUSDT.sol**
4. **Deploy & Run** → Environment: **Injected Provider - MetaMask**
5. Su MetaMask: cambiare network a **Polygon Amoy**
   - Chain ID: 80002
   - RPC: https://rpc-amoy.polygon.technology/
   - Se non configurato: https://chainlist.org/chain/80002
6. Click **Deploy** → confermare su MetaMask
7. Copiare l'indirizzo del contratto deployato

### Opzione B — Foundry (se installato)

```bash
# Installare Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Deploy
forge create MockUSDT.sol:MockUSDT \
  --rpc-url https://rpc-amoy.polygon.technology/ \
  --private-key $GAS_STATION_PRIVATE_KEY

# Copiare l'indirizzo "Deployed to: 0x..."
```

---

## 3. Impostare le env vars di testnet

Dopo il deploy, aggiungere al file `.env.local` o ai Replit Secrets:

```bash
TESTNET_USDT_ADDRESS=0x<indirizzo_contratto_amoy>
TESTNET_FEE_WALLET=0x<indirizzo_fee_wallet>      # opzionale, fallback su POLYGON_FEE_WALLET
POLYGON_TESTNET_RPC_URL=https://rpc-amoy.polygon.technology/  # opzionale (default)
```

> `TESTNET_FEE_WALLET` è l'indirizzo che riceverà la TX2 (projectFee + networkFeeCharged).
> Può essere qualsiasi indirizzo valido — verificare dopo il test che abbia ricevuto i token.

---

## 4. Eseguire il testnet E2E

```bash
cd artifacts/api-server

# Con env vars inline
TESTNET_USDT_ADDRESS=0x... \
TESTNET_FEE_WALLET=0x... \
pnpm exec tsx src/scripts/testnet-e2e-polygon.ts

# Oppure con package.json script
pnpm testnet:e2e
```

### Opzioni runtime

```bash
# Mantenere il record nel DB dopo il test (per debug)
TESTNET_KEEP_DB_RECORD=true pnpm testnet:e2e

# Usare un destinatario TX1 diverso dal gas station wallet
TESTNET_RECIPIENT_WALLET=0x... pnpm testnet:e2e

# Cambiare la flat network fee (default: 0.50 USDT)
POLYGON_FLAT_NETWORK_FEE_USDT=1000000 pnpm testnet:e2e  # 1.00 USDT
```

---

## 5. Cosa viene verificato (12 step)

| Step | Verifica |
|------|---------|
| 1 | Transfer creato in DB con invarianti contabili corrette |
| 2 | Escrow wallet generato, saldo iniziale = 0 |
| 3 | Deposito USDT nell'escrow (mint testnet) |
| 4 | Detection: `awaiting_deposit → pending` + idempotenza |
| 5-8 | Release: gas station top-up POL, TX1, TX2 on-chain |
| 9 | DB: `project_fee`, `network_fee_charged`, `network_fee` separati |
| 10 | No double-payout: secondo release rifiutato |
| 11 | TX1 e TX2 confermate on-chain, importi verificati dai Transfer events |
| 12 | Confronto Blockchain vs DB + zero regressioni USDA |

---

## 6. Interpretare l'output

**Attesi:**
- `grossAmount = 100_000_000` (100.00 USDT)
- `projectFee = 100_000` (0.10 USDT = 0.10%)
- `netAmount = 99_900_000` (99.90 USDT → TX1)
- `networkFeeCharged = 500_000` (0.50 USDT flat → parte di TX2)
- `minDepositAmount = 100_500_000` (100.50 USDT = gross + netFee)
- TX2 on-chain = `100_000 + 500_000 = 600_000` (0.60 USDT)
- `network_fee` = gas POL reale in wei (separato da USDT fees)

**Explorer Amoy:**
- Transazioni: https://www.oklink.com/amoy/tx/<hash>
- Wallet:      https://www.oklink.com/amoy/address/<address>

---

## 7. Troubleshooting

| Errore | Causa | Soluzione |
|--------|-------|-----------|
| `ENV VAR MANCANTE: TESTNET_USDT_ADDRESS` | Mock non deployato | Seguire sezione 2 |
| `Contratto Mock USDT non trovato` | Indirizzo sbagliato o rete errata | Verificare su https://www.oklink.com/amoy/ |
| `Saldo POL insufficiente` | Gas station senza Amoy POL | Usare il faucet (sezione 1) |
| `Detection fallita: status=awaiting_deposit` | Deposito non arrivato | Verificare mint TX su explorer |
| `TRANSACTION_UNDERPRICED` | Gas price Amoy bassa | Riprovare, il gas price Amoy fluttua |
| `chain ID mismatch` | POLYGON_CHAIN_ID non settato | Lo script lo setta automaticamente a 80002 |

---

## Nota: mainnet vs testnet

Lo script `testnet-e2e-polygon.ts` imposta automaticamente:
- `POLYGON_CHAIN_ID=80002` (Amoy) → usato dal gas station per firmare TX con il chainId corretto
- `POLYGON_RPC_URL=<amoyRpc>` → redirect del RPC dalla mainnet ad Amoy
- `ENABLE_POLYGON_USDT=true` → abilita il feature flag

**Queste override sono locali allo script** e non modificano le env vars del server in produzione.
