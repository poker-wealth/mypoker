import { Router, type Request, type Response } from 'express';
import {
  createUserWithPassword,
  verifyPassword,
  findOrCreateGoogleUser,
} from './auth.service';

export function buildAuthRouter(): Router {
  const router = Router();

  router.post('/signup', (req: Request, res: Response) => {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    createUserWithPassword(email, password, displayName)
      .then((user) => {
        res.json({
          playerId: user._id,
          email: user.email,
          displayName: user.displayName,
        });
      })
      .catch((err: Error) => {
        res.status(400).json({ error: err.message });
      });
  });

  router.post('/verify-password', (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    verifyPassword(email, password)
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: 'invalid email or password' });
          return;
        }
        res.json({
          playerId: user._id,
          email: user.email,
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
