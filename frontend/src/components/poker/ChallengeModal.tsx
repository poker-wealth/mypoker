import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function ChallengeModal({
  open,
  onAnswer,
}: {
  open: boolean;
  challengerId: string;
  onAnswer: (passed: boolean, responseMs: number) => void;
}) {
  const [shownAt, setShownAt] = useState<number>(0);
  
  useEffect(() => {
    if (open) {
      setShownAt(Date.now());
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl border border-border text-center relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-danger via-warning to-danger" />
        
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-danger/10 text-danger">
          <ShieldAlert size={32} />
        </div>
        
        <h2 className="text-xl font-bold text-text mb-2">Bot Check</h2>
        <p className="text-sm text-dim mb-6">
          Another player has challenged you to prove you are human. 
          Please tap the button below.
        </p>

        <Button 
          className="w-full h-12 text-lg font-bold bg-danger hover:bg-danger/90 text-white rounded-xl"
          onClick={() => {
            const ms = Date.now() - shownAt;
            onAnswer(true, ms);
          }}
        >
          I am Human
        </Button>
      </motion.div>
    </div>
  );
}
