import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: "inherit", ...options });
const escapeAppleScript = (s) => s.replace(/"/g, '\\"');

const projectRoot = process.cwd();
const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
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
if (!existsSync(appPath)) {
  console.error(`App bundle not found. Tried: ${[preferredAppPath, ...fallbackAppRoots].join(", ")}`);
  process.exit(1);
}

const buildDir = join(projectRoot, "build");
const dmgPath = join(buildDir, `VectCut-${version}-universal.dmg`);
const volumeName = `${productName} ${version}`;
const appBundleName = basename(appPath);

const tmpRoot = join(tmpdir(), `vectcut-dmg-${Date.now()}`);
const srcDir = join(tmpRoot, "src");
const mountPoint = join(tmpRoot, "mnt");
const rwDmgPath = join(tmpRoot, "rw.dmg");
mkdirSync(srcDir, { recursive: true });

try {
  run("ditto", [appPath, join(srcDir, appBundleName)]);
  symlinkSync("/Applications", join(srcDir, "Applications"));
  rmSync(dmgPath, { force: true });

  run("hdiutil", ["create", "-volname", volumeName, "-srcfolder", srcDir, "-ov", "-format", "UDRW", rwDmgPath]);
  mkdirSync(mountPoint, { recursive: true });
  run("hdiutil", ["attach", "-readwrite", "-noverify", "-noautoopen", "-mountpoint", mountPoint, rwDmgPath]);

  try {
    const script = `tell application "Finder"
  tell disk "${escapeAppleScript(volumeName)}"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {100, 100, 740, 460}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 128
    set text size of opts to 14
    set position of item "${escapeAppleScript(appBundleName)}" of container window to {180, 220}
    set position of item "Applications" of container window to {520, 220}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell`;
    run("osascript", ["-e", script]);
  } catch {
    console.warn("Finder UI customization skipped. DMG is still valid.");
  }

  try {
    run("hdiutil", ["detach", mountPoint]);
  } catch {
    run("hdiutil", ["detach", mountPoint, "-force"]);
  }

  run("hdiutil", ["convert", rwDmgPath, "-ov", "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", dmgPath]);
  console.log(`Created styled DMG: ${dmgPath}`);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
