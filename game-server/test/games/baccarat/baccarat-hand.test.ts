import {
  cardValue,
  handTotal,
  playBaccarat,
} from '../../../src/games/baccarat/baccarat-hand';

describe('baccarat card values', () => {
  it('scores A=1, faces/tens=0, pips as-is; total is mod 10', () => {
    expect(cardValue('Ah')).toBe(1);
    expect(cardValue('Kh')).toBe(0);
    expect(cardValue('Ts')).toBe(0);
    expect(cardValue('9c')).toBe(9);
    expect(handTotal(['9c', '7h'])).toBe(6); // 16 → 6
  });
});

describe('baccarat drawing rules', () => {
  // Deal order is Player, Banker, Player, Banker; thirds come from indexes 4,5.
  it('naturals stand — no third cards', () => {
    const r = playBaccarat(['9c', '2d', 'Kh', '3s', '5c', '6c']);
    expect(r.playerCards).toHaveLength(2); // player 9 (natural)
    expect(r.bankerCards).toHaveLength(2);
    expect(r.outcome).toBe('PLAYER');
  });

  it('player draws on 0–5', () => {
    const r = playBaccarat(['2c', '3h', '2d', '4s', '5c', '9d']);
    // player 2c+2d=4 → draws 5c → 9; banker 3h+4s=7 → stands
    expect(r.playerCards).toHaveLength(3);
    expect(r.bankerCards).toHaveLength(2);
    expect(r.playerTotal).toBe(9);
    expect(r.outcome).toBe('PLAYER');
  });

  it('banker draws per the tableau (total 3, player third ≠ 8)', () => {
    const r = playBaccarat(['2c', 'Ah', '3d', '2h', '4s', '6c']);
    // player 2c+3d=5 → draws 4s → 9; banker Ah+2h=3, player third 4 → draws 6c → 9 → TIE
    expect(r.playerCards).toHaveLength(3);
    expect(r.bankerCards).toHaveLength(3);
    expect(r.outcome).toBe('TIE');
  });

  it('banker stands when the player stood and banker is 6–7', () => {
    const r = playBaccarat(['6c', '6h', 'Kd', 'Ks', '4c', '5c']);
    // player 6 → stands; banker 6, player stood → stands → both 2 cards, TIE
    expect(r.playerCards).toHaveLength(2);
    expect(r.bankerCards).toHaveLength(2);
    expect(r.outcome).toBe('TIE');
  });

  it('banker draws when the player stood and banker is 0–5', () => {
    const r = playBaccarat(['7c', '2h', 'Kd', '3s', '4c', '5c']);
    // player 7 → stands; banker 2h+3s=5, player stood → draws 4c → 9 → BANKER
    expect(r.playerCards).toHaveLength(2);
    expect(r.bankerCards).toHaveLength(3);
    expect(r.bankerTotal).toBe(9);
    expect(r.outcome).toBe('BANKER');
  });
});
