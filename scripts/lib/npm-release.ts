type Manifest = {
  name: string;
  version: string;
  dataHash?: string;
  [key: string]: unknown;
};
type Published = { version?: string; dataHash?: string };

/**
 * Publishes the package when its version is new, or — when only the data
 * changed since the last release — as the next patch version.
 */
export class NpmRelease {
  readonly #manifestPath: string;
  readonly #dataHash: string;

  constructor(manifestPath: string, dataHash: string) {
    this.#manifestPath = manifestPath;
    this.#dataHash = dataHash;
  }

  /** The version to publish, or undefined when npm already has this release. */
  nextVersion(manifest: Manifest, published: Published): string | undefined {
    if (
      !published.version ||
      Bun.semver.order(manifest.version, published.version) > 0
    ) {
      return manifest.version;
    }
    if (published.dataHash === this.#dataHash) return undefined;
    const [major = 0, minor = 0, patch = 0] = published.version
      .split(".")
      .map(Number);
    return `${major}.${minor}.${patch + 1}`;
  }

  async run(publishArgs: string[] = []): Promise<number> {
    const file = Bun.file(this.#manifestPath);
    const manifest = (await file.json()) as Manifest;
    const published = this.#published(manifest.name);
    const version = this.nextVersion(manifest, published);
    if (!version) {
      console.log(
        `${manifest.name}@${published.version} already has data ${this.#dataHash}.`,
      );
      return 0;
    }

    await Bun.write(
      file,
      `${JSON.stringify({ ...manifest, version, dataHash: this.#dataHash }, null, 2)}\n`,
    );
    console.log(
      `Publishing ${manifest.name}@${version} (data ${this.#dataHash})`,
    );
    const publish = Bun.spawnSync(
      ["npm", "publish", "--access", "public", ...publishArgs],
      {
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    return publish.exitCode ?? 1;
  }

  #published(name: string): Published {
    const view = Bun.spawnSync([
      "npm",
      "view",
      name,
      "version",
      "dataHash",
      "--json",
    ]);
    if (view.exitCode !== 0) return {};
    const output = view.stdout.toString().trim();
    if (!output) return {};
    // With only one of the fields published, npm prints that value alone.
    const parsed = JSON.parse(output) as Published | string;
    return typeof parsed === "string" ? { version: parsed } : parsed;
  }
}
