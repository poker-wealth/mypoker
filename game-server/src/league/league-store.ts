import { League, PlatformLeaguePolicy, LeagueSettings } from './league';

export interface LeagueProfile {
  id: string;
  name: string;
  members: number;
  online: number;
  vip: boolean;
  icon?: string;
}

const DEFAULT_POLICY: PlatformLeaguePolicy = {
  minRakeBps: 100,
  maxRakeBps: 500,
  maxTableHours: 24,
  minBuyIn: 100,
  maxBuyIn: 10000,
};

const DEFAULT_SETTINGS: LeagueSettings = {
  rakeBps: 300,
  tableHours: 24,
  buyIn: 1000,
  spectatorsAllowed: true,
};

class LeagueStore {
  private profiles = new Map<string, LeagueProfile>();
  private leagues = new Map<string, League>();

  constructor() {
    // Initialize with mock data to mimic the previous frontend hardcoded data
    this.addLeague(
      { id: '123456', name: 'Dragon Alliance', members: 2451, online: 342, vip: true },
      DEFAULT_SETTINGS
    );
    this.addLeague(
      { id: 'phoenix', name: 'Phoenix Club', members: 1892, online: 296, vip: true, icon: '/brand/flame.png' },
      DEFAULT_SETTINGS
    );
    this.addLeague(
      { id: 'king', name: 'King Poker', members: 1563, online: 201, vip: false, icon: '/brand/crown.png' },
      DEFAULT_SETTINGS
    );
    this.addLeague(
      { id: 'ace', name: 'Ace Club', members: 1231, online: 178, vip: false, icon: '/brand/spade.png' },
      DEFAULT_SETTINGS
    );
    this.addLeague(
      { id: 'elite', name: 'Elite Alliance', members: 987, online: 153, vip: false, icon: '/brand/shield.png' },
      DEFAULT_SETTINGS
    );
  }

  addLeague(profile: LeagueProfile, settings: LeagueSettings) {
    this.profiles.set(profile.id, profile);
    this.leagues.set(profile.id, new League(profile.id, DEFAULT_POLICY, settings));
  }

  getProfile(id: string): LeagueProfile | undefined {
    return this.profiles.get(id);
  }

  getLeague(id: string): League | undefined {
    return this.leagues.get(id);
  }

  getAllProfiles(): LeagueProfile[] {
    return Array.from(this.profiles.values());
  }
}

export const leagueStore = new LeagueStore();
