/**
 * Unit tests for the parts of the mobile app that are pure logic.
 *
 * Deliberately NOT `jest-expo`: rendering React Native components needs the
 * whole Metro/Babel/Reanimated stack, and the things worth locking down here —
 * the live-event contract and the notification route map — are plain modules
 * with no native imports. A renderer preset can be added later without moving
 * these tests.
 *
 * `apps/mobile` had no test runner at all before this: `"test"` in
 * package.json was `echo "(no mobile unit tests configured)" && exit 0`, which
 * turbo counted as a pass.
 */
module.exports = {
  testEnvironment: "node",
  // Two tiny suites: in-band is faster, and it avoids ts-jest's worker
  // holding the TS program open past the run ("failed to exit gracefully").
  maxWorkers: 1,
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        // The app's own tsconfig targets a bundler; jest needs CommonJS.
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          target: "ES2021",
          esModuleInterop: true,
          strict: true,
          jsx: "react-jsx",
          types: ["jest", "node"],
        },
      },
    ],
  },
};
