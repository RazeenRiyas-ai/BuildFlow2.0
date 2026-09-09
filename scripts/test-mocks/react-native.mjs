// Minimal test double for react-native — only what push-service.ts (and, transitively, whatever
// else gets pulled into a `node --test` run) actually touches. `react-native` itself can't be
// imported under plain Node (it does native-bridge setup at module load time), which is why no test
// in this project imported anything reaching it before now — see test-alias-loader.mjs, which only
// wires this in under `node --test`, never for the shipped app.

let platformOS = 'ios';

export function __setTestPlatformOS(os) {
  platformOS = os;
}

export const Platform = {
  get OS() {
    return platformOS;
  },
  select(spec) {
    return spec[platformOS] ?? spec.default;
  },
};

export const Linking = {
  openSettings: async () => {},
};
