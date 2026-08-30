import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const packages = [
  {
    name: "d402",
    source: "dist",
    destination: "e2e_tests/node_modules/d402/dist",
    packageJson: "package.json",
    packageDestination: "e2e_tests/node_modules/d402/package.json",
  },
  {
    name: "@d402/ethers",
    source: "adapters/ethers/dist",
    destination: "e2e_tests/node_modules/@d402/ethers/dist",
    packageJson: "adapters/ethers/package.json",
    packageDestination: "e2e_tests/node_modules/@d402/ethers/package.json",
  },
  {
    name: "@d402/viem",
    source: "adapters/viem/dist",
    destination: "e2e_tests/node_modules/@d402/viem/dist",
    packageJson: "adapters/viem/package.json",
    packageDestination: "e2e_tests/node_modules/@d402/viem/package.json",
  },
];

for (const pkg of packages) {
  const source = resolve(root, pkg.source);
  const destination = resolve(root, pkg.destination);
  const packageJson = resolve(root, pkg.packageJson);
  const packageDestination = resolve(root, pkg.packageDestination);

  if (!existsSync(source)) {
    throw new Error(
      `Cannot synchronize ${pkg.name}: built output is missing at ${source}.`,
    );
  }

  if (!existsSync(packageDestination)) {
    throw new Error(
      `Cannot synchronize ${pkg.name}: install E2E dependencies first. ` +
        `Expected ${packageDestination}.`,
    );
  }

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
  cpSync(packageJson, packageDestination);
}

console.log("Synchronized local E2E packages with the current build.");
