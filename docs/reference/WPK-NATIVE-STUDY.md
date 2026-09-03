# WPK native app — functionality study

**Author:** Esther. **Status: WORKSHEET — fill as you walk the app.**

Companion to Samuel's `REFERENCE-STUDY-WPK.md`, which covers 31 screens of the
**H5 web build** (`h5.wpk.com` in Chrome). This one covers the **native app**,
which nobody has looked at.

**Do not re-walk what Samuel already covered.** The Lobby, Games, Friends and
Career tabs are done. The value here is in §2 and §3 — the four things he could
not reach, and anywhere the native app differs from the web build.

---

## Rules, so the two studies merge cleanly

Samuel's conventions, kept deliberately:

1. **Observed vs inferred.** Write what was *on screen*. Anything you worked out
   rather than read, mark **INFERENCE:** — the way he does. A study that mixes
   the two is not usable by anyone else.
2. **If you did not see it, write "not seen".** Do not fill a gap from memory of
   another app, or from a search. That is exactly how §2.1 of the phase plan went
   wrong: bot-vendor pages described a different product and I wrote it up as
   fact.
3. **Screenshot everything you describe.** A line without a screenshot behind it
   is a claim, not a finding.
4. Shots go in `docs/reference/shots/wpk-native/`, named
   `NN-screen-name.png` in the order you walked them.

### Before you screenshot money screens

You are about to open deposit and withdrawal. Two things:

- **Do not enter real card, bank or wallet credentials.** Walk the flow up to the
  point where it asks, screenshot the form, and stop.
- **Redact before committing.** Deposit addresses, QR codes, account numbers,
  your user ID and any balance you would rather not share — black them out.
  Anything committed here is in the repo permanently and the repo is shared.

---

## 1. Provenance — fill this in first

| | |
|---|---|
| Device and OS | |
| How the app was installed | *(App Store / TestFlight / APK / browser + "trust"?)* |
| App version | *(usually under Me → Settings → About)* |
| Date and time of capture | |
| Account state | *(balance? in a club? verified?)* |
| Language the UI came up in | |

**How it installed is itself a finding** — if iOS made you trust a certificate in
Settings, that confirms the sideload route and settles §4.2 of the phase plan.

---

## 2. Priority one — the four things Samuel could not reach

These are the open questions in his §9. Each one changes a decision.

### 2.1 Wallet → Management  ⭐ *the single most valuable screen*

**Why it matters:** it settles whether money is direct player-to-platform or
routed through an agent. The whole money section of the phase plan hangs on it.

Record:

- [ ] What is on the Management screen — list every row and button
- [ ] **Deposit:** what methods? (crypto / bank / card / third-party?) If crypto,
      which chains and which coins?
- [ ] Does any part of the deposit flow mention an **agent, club, or another
      person** — or is it player-to-platform throughout?
- [ ] Minimum / maximum amounts, and any fee shown
- [ ] **Withdraw:** same questions. Any KYC, ID check or verification demanded?
- [ ] Any limits, cooling-off, or "contact support" dead end?
- [ ] Where the four currencies (Diamond / Gold / USD / Points) can be converted
      between, if at all — and in which directions
- [ ] Is there a transaction history? What does one row show?

**Then answer in one sentence:** does WPK move real money inside the app, yes or
no? Everything else in this section is detail.

### 2.2 Inside a club

**Why it matters:** we are being asked to build clubs, and nobody has seen one.

- [ ] How you get in — create, join by code, apply, invite?
- [ ] What the club screen shows: members, roles, chips, tables, history?
- [ ] **Are there roles?** Owner / admin / member / anything agent-shaped?
- [ ] Do club tables use the **same wallet** as the lobby, or a separate
      club-scoped balance?
- [ ] Who creates a club table, and what can they set?
- [ ] Anything about commission, rake share, or paying someone?
- [ ] Is there a member approval queue?

### 2.3 The buy-in / seat sheet  ⭐ *settles a live argument*

**Why it matters:** we currently disagree about seat counts, and this answers it
from the reference rather than from opinion.

- [ ] Sit down at a table. Screenshot the buy-in sheet.
- [ ] Min and max buy-in, and how they relate to the blinds
- [ ] Is there a slider, presets, or free entry?
- [ ] **Seat count for each format** — NLHE, Short Deck, PLO. Count the chairs.
- [ ] What happens if you try to buy in below the minimum? *(ours silently parks
      the player sitting out — worth knowing what they do)*
- [ ] Auto-rebuy / auto-top-up option?
- [ ] Anything about insurance or straddle at the point of sitting

### 2.4 A seated table — the felt itself  ⭐ *blocks our largest phase*

Samuel saw a table as an **observer**. Nobody has seen it as a **player**, and
the action bar only exists for a seated player.

- [ ] **The action bar.** Screenshot it. What buttons, in what order, at what
      size? Fold / Check / Call / Raise — and what raise shortcuts (pot fractions?
      a slider? preset chips?)
- [ ] **Pre-action checkboxes** — "check/fold", "call any"? Where do they sit?
- [ ] What the timer looks like when it is *your* turn vs someone else's
- [ ] **Time bank** — does it exist? Manual button or automatic? What does it look
      like when running?
- [ ] What happens on a win: chips animate? sound? who-won text? Where?
- [ ] Showdown: what is revealed, in what order, and for how long?
- [ ] Emotes, chat, voice — what is on the felt and what is behind a menu?
- [ ] Sit out / stand up / leave — where are they?
- [ ] Does the felt change between NLHE, Short Deck and PLO, or is it one felt?

---

## 3. Priority two — native vs H5

Samuel's whole study is the web build. For each, note **same** or **different**,
and screenshot only the differences.

- [ ] Bottom nav — still Lobby / Games / Friends / Career / Me?
- [ ] Does the app still show a **full-screen interstitial ad** on launch?
- [ ] Is the **sports-betting button** still on the felt?
- [ ] Is the promotions centre still untranslated Chinese in an English UI?
- [ ] Is the mirror-domain row still in the wallet?
- [ ] Do the same eight lobby categories appear?
- [ ] Anything in the native app that has **no web equivalent at all** —
      push notifications, biometric login, native share, haptics?

---

## 4. Priority three — only if there is time

- [ ] Splash and loading sequence *(named in our brief, and unseen)*
- [ ] Sign-up from scratch: what is asked for, is email confirmation required,
      is there any ID check?
- [ ] Settings — what is configurable?
- [ ] Sound and haptics — what has audio, and is there a master toggle?
- [ ] Empty states — a category with no tables, an empty wallet, no club
- [ ] Error states — lose connection mid-hand and screenshot what happens ⭐
      *(reconnect behaviour is on our hardening list and nobody knows what good
      looks like)*

---

## 5. What you conclude

Fill this last, after walking it. Three sentences each, no more.

**Does WPK move real money in-app?**

**What is a club actually for, in this product?**

**What does the native app do that the web build does not?**

**What did you see that we have no equivalent of?**

**What did you see that we already do better?**

---

## 6. Open after this pass

List what you still could not reach and why — locked behind a balance, behind a
club invitation, behind KYC, region-gated. Being explicit about the edge of the
study is what makes the rest of it trustworthy.
