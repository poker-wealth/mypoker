import express, { type Router, type Request, type Response } from 'express';
import { EventEmitter } from 'events';
import { RedEnvelopeModel } from '../games/red-envelope/server/envelope.model';
import { generateRandomSplit, shufflePackets } from '../games/red-envelope/engine/distribution/randomSplit';
import { applyVirtualTransaction } from '../games/red-envelope/server/ledgerOperations';
import { processClaim } from '../games/red-envelope/server/claimProcessor';

export const redEnvelopeEvents = new EventEmitter();

/**
 * Creates the Red Envelope API router.
 * Typically these routes would be protected by an auth middleware that sets `req.user`.
 */
export function createRedEnvelopeRouter(): Router {
  const router = express.Router();

  /**
   * SSE Stream for real-time updates
   */
  router.get('/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const onEvent = (eventName: string, data: any) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    redEnvelopeEvents.on('PACKET_CREATED', (data) => onEvent('PACKET_CREATED', data));
    redEnvelopeEvents.on('PACKET_CLAIMED', (data) => onEvent('PACKET_CLAIMED', data));
    redEnvelopeEvents.on('MINE_HIT', (data) => onEvent('MINE_HIT', data));
    redEnvelopeEvents.on('PACKET_COMPLETED', (data) => onEvent('PACKET_COMPLETED', data));

    req.on('close', () => {
      redEnvelopeEvents.removeAllListeners();
    });
  });

  // Middleware to ensure user is authenticated could go here
  // For now, we assume `req.headers['x-player-id']` or similar for MVP

  /**
   * CREATE a new Red Envelope
   */
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      // In real implementation, this comes from auth
      const hostId = req.headers['x-player-id'] as string;
      if (!hostId) {
        res.status(401).json({ error: 'Missing x-player-id header' });
        return;
      }

      const {
        totalAmountUnits,
        packetCount,
        mineNumber,
        mineMode = 'LAST_DECIMAL_DIGIT',
        penaltyMultiplier = 1.5,
      } = req.body;

      if (!totalAmountUnits || !packetCount || mineNumber === undefined) {
        res.status(400).json({ error: 'Missing required parameters' });
        return;
      }

      // 1. Debit the host's virtual balance for the initial pool
      await applyVirtualTransaction(
        'pending_envelope',
        hostId,
        'ENVELOPE_CREATE',
        -totalAmountUnits,
        `create-${Date.now()}`
      );

      // 2. Generate the packet distribution
      const minAmount = 1; // Minimum 1 unit per packet
      const split = generateRandomSplit({ totalAmount: totalAmountUnits, packetCount, minAmount });
      const shuffledPackets = shufflePackets(split);

      // 3. Create the database record
      const envelope = await RedEnvelopeModel.create({
        hostId,
        totalAmountUnits,
        packetCount,
        remainingPackets: packetCount,
        mineNumber,
        mineMode,
        penaltyMultiplier,
        roundingPolicy: 'ROUND_HALF_UP',
        state: 'ACTIVE',
        packetAmounts: shuffledPackets,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Expires in 24 hours
      });

      res.status(201).json({
        success: true,
        envelopeId: envelope._id,
        state: envelope.state
      });

      redEnvelopeEvents.emit('PACKET_CREATED', {
        envelopeId: envelope._id,
        hostId,
        totalAmountUnits,
        packetCount
      });

    } catch (err: any) {
      console.error('Error creating red envelope:', err);
      res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
  });

  /**
   * CLAIM a packet from an envelope
   */
  router.post('/:id/claim', async (req: Request, res: Response): Promise<void> => {
    try {
      const envelopeId = req.params.id as string;
      const playerId = (Array.isArray(req.headers['x-player-id']) ? req.headers['x-player-id'][0] : req.headers['x-player-id']) as string;

      if (!envelopeId) {
        res.status(400).json({ error: 'Missing envelope ID' });
        return;
      }

      if (!playerId) {
        res.status(401).json({ error: 'Missing x-player-id header' });
        return;
      }

      // Atomically process claim
      const claimResult = await processClaim(envelopeId, playerId);

      if (!claimResult.success) {
        res.status(400).json({ error: claimResult.reason });
        return;
      }

      // If successful, record to ledger
      if (claimResult.netChangeUnits !== undefined && claimResult.netChangeUnits !== 0) {
        const type = claimResult.mineHit ? 'CLAIM_PENALTY' : 'CLAIM_PRIZE';
        await applyVirtualTransaction(
          envelopeId,
          playerId,
          type,
          claimResult.netChangeUnits,
          `claim-${playerId}-${Date.now()}`
        );
      }

      redEnvelopeEvents.emit('PACKET_CLAIMED', {
        envelopeId,
        playerId,
        amountUnits: claimResult.amountUnits
      });

      if (claimResult.mineHit) {
        redEnvelopeEvents.emit('MINE_HIT', {
          envelopeId,
          playerId,
          penaltyUnits: claimResult.penaltyUnits
        });
      }

      res.status(200).json(claimResult);

    } catch (err: any) {
      console.error('Error claiming red envelope:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  /**
   * GET recent active envelopes
   */
  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const activeEnvelopes = await RedEnvelopeModel.find({
        state: 'ACTIVE',
        expiresAt: { $gt: new Date() }
      })
      .select('-packetAmounts') // Exclude hidden amounts
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

      res.json({ envelopes: activeEnvelopes });
    } catch (err) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
}
