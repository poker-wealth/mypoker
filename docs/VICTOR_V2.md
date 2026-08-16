# Victor (senior) — task list V2

My lane: the money core, fairness, third-party isolation, infra/mainnet, launch QA, and reviewing every money-touching PR from Esther and Samuel. Ordered launch-blockers first.

## Tasks, in order

1. **🟠 Commit-then-await the real future Solana block (fairness).** Today every game does `getLatestBlockNumber()+1 → getBlockHash(target)` synchronously at deal time — which **fails on real Solana** (that slot isn't produced yet; it only works with the fake client). Per v6.0: commit the server seed + target slot first, then await the real future block. Reconcile with iron rule #2 (deal at T+0) — the DEALING phase is the seam. Touches `texas-game.ts`, `dou-di-zhu-game.ts`, `san-zhang`, `cowboy-beauty` and the shared seed path. Do it once, behind a shared helper; add tests with a fake chain that produces the block late.

2. **Anti-bot detection signals (spec §anti-bot).** Implement the five the spec names — reaction-time distribution, bet-sizing precision (exact GTO ratios), >16h continuous-online fatigue, **server-enforced 3s-minimum decision time on complex boards**, ≥1s double-confirm gap on all-in/raise>100% pot — as a 0-100 anti-bot score (independent of reputation, never blocks withdrawals). Expose the per-seat inputs Esther feeds into jackpot candidate weighting.

3. **CB1 + CB3 live data feeds.** The breaker logic is done and tested; wire the live metrics — CB1 the insurance-pool balance, CB3 the per-table jackpot-trigger counter — so they fire on real data, not just when handed a parameter.

4. **Slots + Lottery — third-party (PG Soft) connectors.** Both are third-party API integrations (spec: REST/WebSocket adapter, outcomes from the provider, **Jackpot + settlement still through the Financial Core**, strict isolation — a provider outage shows "temporarily unavailable" and must never touch FC). Build the adapter + isolation now against the reference provider so it's ready the moment PG sends sandbox creds; store their RTP docs and show RTP% in the lobby. **Blocked on the owner: PG creds + the static egress IP + integration form.**

5. **Resilience notary activation.** The Polygon L2 + RFC-3161 L3 clients are built; activate them once a funded Polygon key + RPC + a TSA URL exist (env only — `POLYGON_RPC_URL`/`POLYGON_NOTARY_KEY`/`RFC3161_TSA_URL`). Verify the two network round-trips on first real use.

6. **Full 6-path security pen test.** I built the FC money-safety subset (6 attacks, all blocked); finish the transport-layer and fairness attack paths from the spec.

7. **Mainnet cutover** (when the owner provisions keys/funding). Solana mainnet RPC + funded keypair + priority-fee layer; real Polygon L2 + RFC-3161 live; TRON mainnet xpub (deposits) + the withdrawal key in **AWS KMS** (CMK already wired) — fund the CMK-derived address; 20-confirm, official USDT contract.

8. **3-node / HA stand-up.** The `getBestNode` routing + table-migration codec are built; stand up SG (primary) / Tokyo / HK + Redis Sentinel + WAL with the owner/devops; verify region routing + a <500ms migration + WAL consistency.

9. **Chaos drills (5 scenarios)** — node loss, chain outage, Redis failover, DB primary step-down, provider timeout — money integrity holds, no funds stranded.

10. **Mainnet dress rehearsal** — deposit → play → win → withdraw, for real, once the hot path is funded.

11. **Clean full-suite run on healthy hardware** — this box has npm/network + slow-mongo issues; re-confirm the green suites (FC + game-server + frontend) on a good machine and clear the #13 nodemailer verify.

12. **Senior review — every money-touching PR from Esther + Samuel:** DDZ seed, jackpot weighting, email hooks, create-table money shape, admin money actions. No money code merges without it.

## Owner-blocked — chase these early (they gate the above)
- Mainnet keys + funding: TRON mainnet xpub, hot-wallet **or** AWS KMS CMK, Solana keypair, fund within cap.
- PG Soft: **static egress IP (Fixie) + integration form + sandbox creds** — unblocks Slots + Lottery.
- SMTP mailbox creds (email); SMS provider (if OTP is wanted); 3-node infra machines.

## Realistic note
Games/fairness/frontend/notifications verification is a genuine **this-week** push. The native app (with app-store review), mainnet cutover, 3-node stand-up, and chaos drills **start this week but span beyond it** — several are gated on owner provisioning. This doc sequences them; it doesn't pretend they all land in seven days.
