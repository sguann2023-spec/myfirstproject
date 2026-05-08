import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const projectRoot = process.cwd();
const pkgPath = join(projectRoot, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const version = pkg.version;
const productName = pkg?.build?.productName || pkg.name || "App";
const appName = `${productName}.app`;
const preferredAppPath = join(projectRoot, "build", "mac-universal", appName);
const fallbackAppRoots = [join(projectRoot, "build", "mac-universal"), join(projectRoot, "build", "mac")];

let appPath = preferredAppPath;
if (!existsSync(appPath)) {
  for (const root of fallbackAppRoots) {
    if (!existsSync(root)) continue;
    const appCandidate = readdirSync(root).find((name) => name.endsWith(".app"));
    if (appCandidate) {
      appPath = join(root, appCandidate);
      break;
    }
  }
}
const dmgPath = join(projectRoot, "build", `VectCut-${version}-universal.dmg`);
const volumeName = `${productName} ${version}`;

if (!existsSync(appPath)) {
  console.error(`App bundle not found. Tried: ${[preferredAppPath, ...fallbackAppRoots].join(", ")}`);
  process.exit(1);
}

const stagingRoot = join(tmpdir(), `vectcut-dmg-${Date.now()}`);
const stagingDir = join(stagingRoot, "src");
mkdirSync(stagingDir, { recursive: true });

try {
  execFileSync("ditto", [appPath, join(stagingDir, appName)], { stdio: "inherit" });
  symlinkSync("/Applications", join(stagingDir, "Applications"));

  rmSync(dmgPath, { force: true });
  execFileSync(
    "hdiutil",
    [
      "create",
      "-volname",
      volumeName,
      "-srcfolder",
      stagingDir,
      "-ov",
      "-format",
      "UDZO",
      dmgPath
    ],
    { stdio: "inherit" }
  );
  console.log(`Created DMG: ${dmgPath}`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
