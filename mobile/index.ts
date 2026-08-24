// MUST be the first import in the app.
//
// React Native has no `crypto.getRandomValues`. @noble/curves needs it to generate the X25519
// keypair for the live-table handshake, and it throws "crypto.getRandomValues must be defined" the
// moment a table is opened. `react-native-get-random-values` was already a dependency but nothing
// ever imported it, so the polyfill was never installed — the package being in package.json does
// nothing on its own.
//
// It has to run before ANY module that touches crypto is evaluated, which is why it sits above the
// App import rather than inside a component: imports are hoisted and evaluated in order, so a
// polyfill imported later than its consumer is a polyfill that arrives too late.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
