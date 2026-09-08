/**
 * Grant or revoke the platform administrator role.
 *
 * A SCRIPT AND NOT AN HTTP ROUTE, on purpose. An endpoint that promotes an
 * account to administrator is the most valuable thing on the platform to
 * compromise: it converts any authentication bug anywhere into full control of
 * the treasury, the withdrawal queue and every player record. Requiring shell
 * access to the server means an attacker needs the server before they need the
 * panel, which is the right order.
 *
 * There is deliberately no bootstrap route either — no "first user becomes
 * admin", no env-var allowlist read at sign-in. Both have the same failure: they
 * are a promotion path that exists in the running process.
 *
 *   npx ts-node scripts/grant-ops.ts <email>            # grant
 *   npx ts-node scripts/grant-ops.ts <email> --revoke   # revoke
 *   npx ts-node scripts/grant-ops.ts --list             # who currently holds it
 *
 * Requires MONGO_URI (the gateway's own database — the user store lives in the
 * gateway, not in financial-core).
 */
import mongoose from 'mongoose';
import { UserModel } from '../src/auth/user.model';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is required (the gateway database, where the user store lives).');
    process.exit(2);
  }

  await mongoose.connect(uri, {
    tls: process.env.MONGO_TLS === 'true',
    serverSelectionTimeoutMS: 10_000,
  });

  try {
    if (args.includes('--list')) {
      const admins = await UserModel.find({ role: 'ops' }).lean();
      if (admins.length === 0) {
        // Said plainly, because this is the state that makes the admin panel
        // unreachable, and "no output" reads as "the command did nothing".
        console.log('No administrators. Nobody can reach the admin panel.');
      } else {
        console.log(`${admins.length} administrator(s):`);
        for (const a of admins) {
          console.log(`  ${a.email ?? a._id}  (${a._id})${a.suspendedAt ? '  [SUSPENDED]' : ''}`);
        }
      }
      return;
    }

    const email = args.find((a) => !a.startsWith('--'));
    if (!email) {
      console.error('Usage: grant-ops.ts <email> [--revoke]   |   grant-ops.ts --list');
      process.exitCode = 2;
      return;
    }

    const revoke = args.includes('--revoke');
    const user = await UserModel.findOne({ email: email.trim().toLowerCase() }).lean();
    if (!user) {
      // Distinguished from "found but not changed": an admin who mistypes an
      // address should not be told the grant succeeded.
      console.error(`No account with email ${email}.`);
      console.error('The account must exist first — this promotes, it does not create.');
      process.exitCode = 1;
      return;
    }

    if (revoke) {
      // The last administrator revoking themselves locks the panel with nobody
      // able to reopen it except through this script on the server. Refused, so
      // that the way back in is always the same way in.
      const others = await UserModel.countDocuments({ role: 'ops', _id: { $ne: user._id } });
      if (others === 0) {
        console.error(`${email} is the only administrator — revoking would lock the panel.`);
        console.error('Grant it to someone else first.');
        process.exitCode = 1;
        return;
      }
      await UserModel.updateOne({ _id: user._id }, { $set: { role: 'player' } });
      console.log(`Revoked ops from ${email} (${user._id}).`);
      return;
    }

    await UserModel.updateOne({ _id: user._id }, { $set: { role: 'ops' } });
    console.log(`Granted ops to ${email} (${user._id}).`);
    // The role rides in the JWT, which is only minted at sign-in. Said out loud
    // because otherwise the grant looks broken for the length of a session.
    console.log('They must sign out and back in — the role is carried in the token.');
    if (user.suspendedAt) {
      console.log('NOTE: this account is currently suspended and cannot sign in at all.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('grant-ops failed:', err);
  process.exit(2);
});
