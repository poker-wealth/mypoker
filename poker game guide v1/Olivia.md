# Olivia — task list V2 (Testing)

You're the tester. Your job is simple to say and important: **be a real player, try to break things, and report clearly what you find.** Nothing counts as "done" on this project until you've played it start to finish and it worked — so your reports are what tell the team what's actually finished and what isn't. You don't need to touch any code.

## Before you start (ask Victor for these)
- The **app link** — the web app / Telegram Mini App to test on.
- A **test account** and **test money** — this runs on a test network, so **no real money is involved.** You can deposit and play freely.
- Where to **file what you find** — a shared sheet, a chat channel, or GitHub Issues (Victor will tell you which). Use whatever they give you consistently.
- Ask which things are **ready to test now** vs still being built — no point reporting a screen that isn't finished yet. Victor will keep you pointed at what's ready.

## The one rule
A thing is **done only if a real person can use it from start to finish and the money is right.** If you can't finish it, or the balance looks wrong, it's **not** done — report it.

## What to test

### 1. The games (most important)
For **each game** — Texas Hold'em, Short Deck, Omaha, Baccarat, Niu Niu, San Zhang, Red Packet, Dou Di Zhu, Cowboy & Beauty (Lottery and Slots come later, they're from an outside provider):

1. Open the game, take a seat, buy in.
2. Play a **full round** to the end.
3. Win **and** lose at least once.
4. **Check the wallet:** after a win your balance went **up** by the right amount; after a loss it went **down** by the right amount. This is the part that matters most — if the money is ever wrong, stop and report it immediately.
5. Look at the screen: cards, chips, buttons, animations, text — anything that looks broken, cut off, mislabelled, or confusing.

### 2. The money (deposit & withdrawal)
- **Deposit** test money → confirm it shows up in your balance.
- **Request a withdrawal** → confirm it's accepted and the receipt/notification looks right. (Ask Victor how far the withdrawal can go on test — some of it may still be in progress.)

### 3. The screens
Open each and check it shows real information and every button does something: **Profile, VIP, Jackpot, Alliance, Agent Center, Notifications, Data/History, Settings.** Note anything empty, wrong, or that does nothing when tapped.

### 4. Platforms
Test on whatever is available now (web / Telegram). When the **iOS and Android apps** are ready later, you'll test the same things again on those — the same round, deposit, and withdrawal must work on all three.

## Priority order
1. The **games that are live** + the **money (deposit/withdraw)** — these are launch-critical.
2. The screens.
3. Edge cases — try to break things: tap fast, leave mid-hand, bad inputs, weak connection.

## How to report something (keep it consistent)
For each issue, give:
- **What / where:** which game or screen.
- **Device:** phone/computer + web or Telegram (later: iOS/Android).
- **Steps:** what you did, in order, so someone can repeat it.
- **Expected:** what should have happened.
- **Actual:** what actually happened.
- **Proof:** a screenshot or short screen recording — always, if you can.
- **How bad:** *money wrong* (most urgent) → *broken/can't continue* → *looks wrong / confusing*.

A money bug is always top priority — flag those first and loudest.

## Cadence
Report as you go; a short **daily summary** of what you tested, what passed, and what's still broken. That daily list is how the team knows how close we are to launch.
