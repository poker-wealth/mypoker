import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * The navigation contract.
 *
 * Declared in its own file, and exported, because it is half of the seam
 * between the shell and the game side: the shell decides WHICH table, this
 * types how that decision reaches the table screen. Esther gets
 * `route.params.tableId` as a checked string rather than `any`.
 *
 * `undefined` for Tabs means the tab navigator takes no params of its own —
 * each tab manages its own state.
 */
export type RootStackParamList = {
  Tabs: undefined;
  Table: { tableId: string };
  Vip: undefined;
  Notifications: undefined;
  Settings: undefined;
  AgentCenter: undefined;
  Wallet: undefined;
  /** A dev-only felt harness, registered only when __DEV__. See App.tsx. */
  FeltGallery: undefined;
};

/** Props for a screen in the root stack. `TableScreenProps` is the one the game side uses. */
export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type TableScreenProps = RootStackScreenProps<'Table'>;

/**
 * Makes `navigation.navigate('Table', { tableId })` type-checked everywhere,
 * including from screens that never import these types.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
