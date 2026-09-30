# BrickShare demo: a 5-minute walk-through

Do the **Quick start** in the [README](README.md) first, including `npm run demo-data`. Then follow these steps. Each one says what to click and what to say.

Tip: use two browser windows side by side (one normal, one private), so you can be two people at once.

## 1. The idea (30 seconds)

Open http://localhost:3000 (not logged in).

> "BrickShare lets an owner split a property into small shares. Verified investors buy them with rupees, earn rent, and trade them like stocks. Who owns what is kept on a private blockchain, not in our database."

## 2. The blockchain is real (1 minute)

Click **Network** in the top bar.

> "Our blockchain has 4 nodes, run by BrickShare, a property company and the Land Authority. Every 2 seconds they vote on a new block. All 4 show the same block, so they agree on who owns what."

Optional, to impress: in PowerShell run `docker stop land-authority`. The page shows 3 of 4 online, and blocks keep coming. Then `docker start land-authority` and it catches up.

## 3. The market (1 minute)

Click **Market**, then **Sea View Flat**, then **Trade on the market**.

> "This is like Zerodha or Groww. The chart, the order book and the latest trades are live. Each trade moved shares on the blockchain before any money moved."

## 4. A live trade (1 minute)

- Window 1: log in as **alice@demo.test** / demo1234. Open the Sea View Flat trade page.
- Window 2: log in as **bob@demo.test** / demo1234. Open the same page.
- As Bob, click the lowest red price in the order book (a sell offer from Alice), then **Buy**.

> "The orders matched at once. Watch Alice's screen: the trade, the price and the chart update live. In a few seconds the trade says settled: the blockchain confirmed it."

## 5. Portfolio and rent (30 seconds)

As Alice, open **Portfolio**.

> "Alice's shares are read straight from the blockchain. The owner paid ₹50,000 rent, and the smart contract shared it by how many shares each person held. That's Alice's rent earned."

## 6. The Land Authority freeze (1 minute)

Open **Market**, then **Green Villa**.

> "The Land Authority froze this property because of a court case. The blockchain itself blocks every buy and sell. Not even BrickShare can get around it."

To show it live: log in as **land@brickshare.test** / land123, open **Land Authority**, and unfreeze Green Villa (or freeze Sea View Flat, then try to trade as Bob).

## 7. The papers can't be faked (30 seconds)

Open any property page and look at **Property papers (IPFS)**.

> "The papers are stored on IPFS, a peer-to-peer file network like torrents. Their fingerprint is saved in the smart contract, and 'Matches blockchain' means the file still matches it. Change one letter and the fingerprint changes."

## If someone asks

- **Is this real money?** No. Payments are fake (or Razorpay test mode). The footer says so.
- **Why a private blockchain?** Only trusted, known organisations run nodes, so it's fast and free, but no single one of them can change the records alone.
- **What if the server crashes after a payment?** The order waits as "paid". When the server starts again it checks the blockchain, then finishes it, so shares never move twice. Razorpay webhooks also catch payments when the investor closes the app too early.
