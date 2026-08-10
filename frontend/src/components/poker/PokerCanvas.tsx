import { useEffect, useRef } from 'react';
import type { TableState } from '@/lib/table';

interface PokerCanvasProps {
  state: TableState;
  /** Live tables: tapping an open chair sits you down (called with the SERVER seat index). */
  onSit?: (seatIndex: number) => void;
  onChallenge?: (playerId: string) => void;
}

export function PokerCanvas({ state, onSit, onChallenge }: PokerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions with DevicePixelRatio for sharp rendering
    const width = 800;
    const height = 960;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.clearRect(0, 0, width, height);

    // 1. Draw felt background (outer glow, rail, inner felt)
    const centerX = width / 2;
    const centerY = height / 2 - 10;
    const radiusX = width * 0.42;
    const radiusY = height * 0.38;

    // Outer rail glow
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX + 16, radiusY + 16, 0, 0, Math.PI * 2);
    const glowGrad = ctx.createRadialGradient(centerX, centerY, radiusY * 0.8, centerX, centerY, radiusY * 1.3);
    glowGrad.addColorStop(0, 'rgba(187, 92, 246, 0.25)');
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fill();
    ctx.restore();

    // Outer rail border
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX + 8, radiusY + 8, 0, 0, Math.PI * 2);
    const railGrad = ctx.createLinearGradient(0, 0, width, height);
    railGrad.addColorStop(0, '#6366f1');
    railGrad.addColorStop(0.5, '#bb5cf6');
    railGrad.addColorStop(1, '#00d4ff');
    ctx.fillStyle = railGrad;
    ctx.fill();
    ctx.restore();

    // Inner Felt
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    const feltGrad = ctx.createRadialGradient(centerX, centerY * 0.9, 20, centerX, centerY, radiusY);
    feltGrad.addColorStop(0, '#1c3d70');
    feltGrad.addColorStop(0.5, '#12233f');
    feltGrad.addColorStop(1, '#081121');
    ctx.fillStyle = feltGrad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();
    ctx.restore();

    // Brand Watermark on Felt
    ctx.save();
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MYPOKER', centerX, centerY + 30);
    ctx.restore();

    // 2. Draw Pot & Board
    // Pot badge
    if (state.pot > 0) {
      const potText = `POT $${(state.pot / 1_000_000).toLocaleString()}`;
      ctx.save();
      ctx.font = 'bold 13px Inter, sans-serif';
      const textWidth = ctx.measureText(potText).width;
      const pillW = textWidth + 24;
      const pillH = 26;
      const pillX = centerX - pillW / 2;
      const pillY = centerY - 95;

      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 13);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fill();
      ctx.strokeStyle = '#bb5cf6';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#f5b93b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(potText, centerX, pillY + pillH / 2);
      ctx.restore();
    }

    // Community Board Cards (5 slots)
    const cardW = 54;
    const cardH = 76;
    const cardGap = 8;
    const boardStartX = centerX - (5 * cardW + 4 * cardGap) / 2;
    const boardY = centerY - 50;

    for (let i = 0; i < 5; i++) {
      const cx = boardStartX + i * (cardW + cardGap);
      const cardStr = state.board[i];

      if (cardStr) {
        // Draw dealt community card
        drawCard(ctx, cx, boardY, cardW, cardH, cardStr);
      } else {
        // Draw empty card slot
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(cx, boardY, cardW, cardH, 6);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 3. Draw Player Seats Ring (up to 9 seats around felt)
    const totalSeats = Math.max(6, state.seats.length);
    const seatsList = state.seats;

    for (let i = 0; i < totalSeats; i++) {
      const angle = (i / totalSeats) * Math.PI * 2 + Math.PI / 2;
      const seatX = centerX + Math.cos(angle) * (radiusX + 10);
      const seatY = centerY + Math.sin(angle) * (radiusY + 10);
      const seat = seatsList[i];

      if (seat && seat.status !== 'empty') {
        // Occupied Seat
        const avatarR = 26;

        // Active Turn Ring
        const isTurn = seat.status === 'toact' || Boolean(seat.deadline);
        if (isTurn) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(seatX, seatY, avatarR + 6, 0, Math.PI * 2);
          ctx.strokeStyle = '#bb5cf6';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        }

        // Avatar Circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(seatX, seatY, avatarR, 0, Math.PI * 2);
        const avGrad = ctx.createLinearGradient(seatX - avatarR, seatY - avatarR, seatX + avatarR, seatY + avatarR);
        avGrad.addColorStop(0, seat.isHero ? '#6366f1' : '#374151');
        avGrad.addColorStop(1, seat.isHero ? '#bb5cf6' : '#1f2937');
        ctx.fillStyle = avGrad;
        ctx.fill();
        ctx.strokeStyle = seat.isHero ? '#00d4ff' : '#4b5563';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Player Initial
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const initial = (seat.name || 'P').charAt(0).toUpperCase();
        ctx.fillText(initial, seatX, seatY);
        ctx.restore();

        // Name & Chips Badge below seat
        const labelW = 90;
        const labelH = 32;
        const labelX = seatX - labelW / 2;
        const labelY = seatY + avatarR + 4;

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(labelX, labelY, labelW, labelH, 6);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Name
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = '#f3f4f6';
        ctx.textAlign = 'center';
        ctx.fillText(truncateText(ctx, seat.name || 'Player', labelW - 10), seatX, labelY + 12);

        // Chips / Status
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = '#f5b93b';
        const chipText = `$${(seat.stack / 1_000_000).toLocaleString()}`;
        ctx.fillText(chipText, seatX, labelY + 24);
        ctx.restore();

        // Hole cards next to seat
        if (seat.cards && seat.cards.length > 0) {
          const hcW = 28;
          const hcH = 38;
          const hcY = seatY - avatarR - 12;
          seat.cards.forEach((cStr, cIdx) => {
            const hcX = seatX - 16 + cIdx * 14;
            drawCard(ctx, hcX, hcY, hcW, hcH, cStr || '??', true);
          });
        }

        // Bet Stack
        if (seat.bet > 0) {
          const betX = seatX + (centerX - seatX) * 0.35;
          const betY = seatY + (centerY - seatY) * 0.35;

          ctx.save();
          ctx.font = 'bold 10px Inter, sans-serif';
          ctx.fillStyle = '#00d4ff';
          ctx.textAlign = 'center';
          ctx.fillText(`$${(seat.bet / 1_000_000).toLocaleString()}`, betX, betY);
          ctx.restore();
        }
      } else {
        // Empty Seat
        const avatarR = 24;
        ctx.save();
        ctx.beginPath();
        ctx.arc(seatX, seatY, avatarR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+ SIT', seatX, seatY);
        ctx.restore();
      }
    }
  }, [state]);

  // Click Handler for Canvas Elements (Sitting down & Challenge)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 800;
    const clickY = ((e.clientY - rect.top) / rect.height) * 960;

    const centerX = 400;
    const centerY = 470;
    const radiusX = 800 * 0.42;
    const radiusY = 960 * 0.38;
    const totalSeats = Math.max(6, state.seats.length);

    for (let i = 0; i < totalSeats; i++) {
      const angle = (i / totalSeats) * Math.PI * 2 + Math.PI / 2;
      const seatX = centerX + Math.cos(angle) * (radiusX + 10);
      const seatY = centerY + Math.sin(angle) * (radiusY + 10);
      const dist = Math.hypot(clickX - seatX, clickY - seatY);

      if (dist <= 36) {
        const seat = state.seats[i];
        if (!seat || seat.status === 'empty') {
          onSit?.(i);
        } else if (onChallenge && seat.playerId && !seat.isHero) {
          onChallenge(seat.playerId);
        }
        break;
      }
    }
  };

  return (
    <div className="relative mx-auto flex w-full max-w-[440px] items-center justify-center px-2">
      <canvas
        id="poker-table-canvas"
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full h-auto object-contain cursor-pointer drop-shadow-2xl select-none"
        style={{ aspectRatio: '800 / 960' }}
      />
    </div>
  );
}

// Helper: Draw Playing Card on 2D Canvas
function drawCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cardStr: string,
  mini = false,
) {
  ctx.save();

  // Back of card
  if (cardStr === '??' || !cardStr) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, mini ? 4 : 6);
    ctx.fillStyle = '#1e1b4b';
    ctx.fill();
    ctx.strokeStyle = '#4338ca';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pattern
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, w - 6, h - 6, mini ? 2 : 4);
    ctx.fillStyle = '#312e81';
    ctx.fill();
    ctx.restore();
    return;
  }

  // Face of card
  const rank = cardStr.slice(0, -1);
  const suitChar = cardStr.slice(-1).toLowerCase();
  const isRed = suitChar === 'h' || suitChar === 'd';
  const suitSymbol = suitChar === 'h' ? '♥' : suitChar === 'd' ? '♦' : suitChar === 's' ? '♠' : '♣';

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, mini ? 4 : 6);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Rank & Suit
  ctx.fillStyle = isRed ? '#dc2626' : '#111827';
  ctx.font = `bold ${mini ? 11 : 16}px Inter, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(rank, x + (mini ? 3 : 5), y + (mini ? 2 : 4));

  ctx.font = `${mini ? 10 : 14}px Inter, sans-serif`;
  ctx.fillText(suitSymbol, x + (mini ? 3 : 5), y + (mini ? 14 : 22));

  // Big center suit
  if (!mini) {
    ctx.font = '22px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(suitSymbol, x + w - 4, y + h - 4);
  }

  ctx.restore();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxW) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}
