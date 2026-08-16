import { ShieldCheck, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export interface FairnessData {
  roundId?: string;
  serverCommit?: string;
  serverSeed?: string;
  futureBlockHash?: string;
  finalSeed?: string;
}

export function FairnessModal({
  fairness,
  onClose,
}: {
  fairness?: FairnessData;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyData = () => {
    if (!fairness) return;
    const text = JSON.stringify(fairness, null, 2);
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-indigo-500/30 bg-slate-900 p-6 text-white shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-400" />
            <h3 className="font-bold text-lg text-slate-100">Provably Fair Verification</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition font-bold text-lg"
          >
            ✕
          </button>
        </div>

        {/* Content Details */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="text-slate-400 block font-semibold mb-1">Round ID</label>
            <div className="rounded bg-slate-950 p-2 font-mono text-indigo-300 border border-slate-800 select-all">
              {fairness?.roundId ?? 'Hand in progress'}
            </div>
          </div>

          <div>
            <label className="text-slate-400 block font-semibold mb-1">
              Server Commitment (HMAC-SHA256)
            </label>
            <div className="rounded bg-slate-950 p-2 font-mono text-amber-300 border border-slate-800 break-all select-all">
              {fairness?.serverCommit ?? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
            </div>
          </div>

          {fairness?.serverSeed && (
            <div>
              <label className="text-slate-400 block font-semibold mb-1">
                Revealed Server Seed
              </label>
              <div className="rounded bg-slate-950 p-2 font-mono text-emerald-300 border border-slate-800 break-all select-all">
                {fairness.serverSeed}
              </div>
            </div>
          )}

          {fairness?.finalSeed && (
            <div>
              <label className="text-slate-400 block font-semibold mb-1">Final Combined Seed</label>
              <div className="rounded bg-slate-950 p-2 font-mono text-cyan-300 border border-slate-800 break-all select-all">
                {fairness.finalSeed}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-3">
          <Button variant="secondary" size="sm" onClick={copyData}>
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied to Clipboard' : 'Copy Hashes'}
          </Button>

          <Button variant="primary" size="sm" onClick={onClose}>
            Close Inspector
          </Button>
        </div>
      </div>
    </div>
  );
}
