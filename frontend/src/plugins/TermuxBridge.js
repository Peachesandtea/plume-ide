import { registerPlugin } from '@capacitor/core';

class TermuxBridgeWeb {
  async runTermuxCommand(_opts) {
    throw new Error('TermuxBridge is only available on Android with Termux installed');
  }

  async isTermuxInstalled() {
    return { installed: false };
  }
}

// On Android this routes to TermuxBridgePlugin in MainActivity.kt.
// On web/iOS the fallback above is used instead.
export const TermuxBridge = registerPlugin('TermuxBridge', {
  web: () => new TermuxBridgeWeb(),
});
