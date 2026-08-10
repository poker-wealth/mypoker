import { Router, type Request, type Response } from 'express';
import {
  createUserWithPassword,
  verifyPassword,
  findOrCreateGoogleUser,
} from './auth.service';

export function buildAuthRouter(): Router {
  const router = Router();

  router.post('/signup', (req: Request, res: Response) => {
    const identifier = req.body.email || req.body.phone || req.body.identifier;
    const { password, displayName } = req.body;

    if (!identifier || !password) {
      res.status(400).json({ error: 'email or phone number and password are required' });
      return;
    }

    createUserWithPassword(identifier, password, displayName)
      .then((user) => {
        res.json({
          playerId: user._id,
          email: user.email || user.phone,
          displayName: user.displayName,
        });
      })
      .catch((err: Error) => {
        res.status(400).json({ error: err.message });
      });
  });

  router.post('/verify-password', (req: Request, res: Response) => {
    const identifier = req.body.email || req.body.phone || req.body.identifier;
    const { password } = req.body;

    if (!identifier || !password) {
      res.status(400).json({ error: 'email or phone number and password are required' });
      return;
    }

    verifyPassword(identifier, password)
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: 'invalid email or password' });
          return;
        }
        res.json({
          playerId: user._id,
          email: user.email || user.phone,
          displayName: user.displayName,
        });
      })
      .catch(() => {
        res.status(500).json({ error: 'internal server error' });
      });
  });

  router.post('/oauth', (req: Request, res: Response) => {
    const { googleId, email, displayName, photoUrl } = req.body;

    if (!googleId || !email) {
      res.status(400).json({ error: 'googleId and email are required' });
      return;
    }

    findOrCreateGoogleUser(googleId, email, displayName, photoUrl)
      .then((user) => {
        res.json({
          playerId: user._id,
          email: user.email,
          displayName: user.displayName,
          photoUrl: user.photoUrl,
        });
      })
      .catch((err: Error) => {
        res.status(400).json({ error: err.message });
      });
  });

  return router;
}
