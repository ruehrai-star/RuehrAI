/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.(spec|e2e-spec)\\.ts$",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        isolatedModules: false,
        tsconfig: {
          module: "commonjs",
          target: "ES2022",
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          types: ["jest", "node"],
        },
      },
    ],
  },
  testEnvironment: "node",
  setupFiles: ["<rootDir>/test/setup-env.js"],
  testTimeout: 20000,
};
