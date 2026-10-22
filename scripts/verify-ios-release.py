#!/usr/bin/env python3
"""Check a saved Kit app/archive without installing, modifying, or uploading it."""
import argparse
import hashlib
import html
import json
import plistlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("artifact", type=Path, help="App.app or .xcarchive directory")
parser.add_argument("--minimum-build", type=int, default=9)
parser.add_argument("--distribution", action="store_true", help="Require distribution entitlements after export")
parser.add_argument("--report", type=Path)
args = parser.parse_args()
app = args.artifact
if app.suffix == ".xcarchive":
    archive_info = plistlib.loads((app / "Info.plist").read_bytes())
    app = app / "Products" / archive_info["ApplicationProperties"]["ApplicationPath"]
checks = []


def check(name, condition, detail):
    checks.append({"name": name, "passed": bool(condition), "detail": detail})


def version(value):
    return tuple(int(part) for part in re.findall(r"\d+", str(value))[:3])


def files_digest(folder):
    return {
        str(file.relative_to(folder)): hashlib.sha256(file.read_bytes()).hexdigest()
        for file in sorted(folder.rglob("*")) if file.is_file()
    }


try:
    info = plistlib.loads((app / "Info.plist").read_bytes())
    build = str(info.get("CFBundleVersion", ""))
    check("Bundle identity", info.get("CFBundleIdentifier") == "com.kai.kit", "com.kai.kit preserves the existing app identity")
    check("New build number", build.isdigit() and int(build) >= args.minimum_build, build)
    check("Device SDK", info.get("DTPlatformName") == "iphoneos" and version(info.get("DTSDKName", "")) >= (26,), str(info.get("DTSDKName")))
    check("Supported iOS floor", version(info.get("MinimumOSVersion", "")) >= (16, 4), str(info.get("MinimumOSVersion")))
    check("Declared device families", set(info.get("UIDeviceFamily", [])) == {1, 2}, "iPhone + iPad; separate device QA is still required")
    check("Encryption declaration", info.get("ITSAppUsesNonExemptEncryption") is False, "Current app uses no non-exempt encryption; reassess if dependencies change")
    check("Capture permission descriptions", all(info.get(key, "").strip() for key in ("NSCameraUsageDescription", "NSMicrophoneUsageDescription")), "Camera and microphone usage descriptions are bundled")
    check("Compiled app icons", bool(info.get("CFBundleIcons")) and bool(info.get("CFBundleIcons~ipad")) and (app / "Assets.car").is_file(), "iPhone/iPad icon catalog is present")

    cap = json.loads((app / "capacitor.config.json").read_text())
    check("Bundled app configuration", cap.get("appId") == "com.kai.kit" and not cap.get("server", {}).get("url"), "No live-reload server URL")
    custom_plugins = {"ICloudPlugin", "ICloudSyncPlugin", "LibraryControlsPlugin", "MediaClipboardPlugin"}
    check("Custom native bridges", custom_plugins.issubset(set(cap.get("packageClassList", []))), ", ".join(sorted(custom_plugins)))
    check("Bundled offline assets", all((app / "public" / name).is_file() for name in ("index.html", "sql-wasm.wasm", "privacy.html", "support.html")), "App, database runtime, privacy and support pages exist")
    check("Current web assets", files_digest(app / "public") == files_digest(ROOT / "ios/App/App/public"), "Archive matches the synced native asset tree")
    check("No development study pages", not (app / "public/design").exists(), "Developer studies are not included as app screens")
    entry_html = (app / "public/index.html").read_text()
    policy = re.search(r'<meta\s+[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"', entry_html)
    policy_text = html.unescape(policy.group(1)) if policy else ""
    check("Imported markup script protection", "script-src 'self' 'wasm-unsafe-eval'" in policy_text and "'unsafe-inline'" not in policy_text and "'unsafe-eval'" not in policy_text and "frame-src 'none'" in policy_text, "Production CSP blocks inline handlers, nested card frames and JavaScript eval while allowing SQL.js WebAssembly")

    privacy = plistlib.loads((app / "PrivacyInfo.xcprivacy").read_bytes())
    reasons = {item.get("NSPrivacyAccessedAPIType"): item.get("NSPrivacyAccessedAPITypeReasons", []) for item in privacy.get("NSPrivacyAccessedAPITypes", [])}
    check("Root privacy declaration", privacy.get("NSPrivacyTracking") is False and not privacy.get("NSPrivacyCollectedDataTypes"), "No app tracking or developer data collection declared")
    check("File timestamp reason", "C617.1" in reasons.get("NSPrivacyAccessedAPICategoryFileTimestamp", []), "Required-reason file APIs are declared")
    manifests = list(app.rglob("PrivacyInfo.xcprivacy"))
    for manifest in manifests:
        plistlib.loads(manifest.read_bytes())
    check("SDK privacy resources", len(manifests) >= 3, f"{len(manifests)} readable app/SDK privacy manifests")

    verified = subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], capture_output=True, text=True)
    check("Code signature", verified.returncode == 0, "Signature verification passed" if verified.returncode == 0 else verified.stderr.strip())
    signed = subprocess.run(["codesign", "--display", "--entitlements", "-", "--xml", str(app)], capture_output=True)
    entitlements = plistlib.loads(signed.stdout)
    check("Signed iCloud container", "iCloud.com.kai.kit" in entitlements.get("com.apple.developer.ubiquity-container-identifiers", []), "Existing iCloud container is retained")
    check("Signed app identifier", entitlements.get("application-identifier") == "V9QB5Z3JN8.com.kai.kit", "Existing Apple team and application identifier are retained")
    if args.distribution:
        check("Distribution debugging disabled", entitlements.get("get-task-allow") is False, "Distribution export must not permit debugger attachment")
        check("Production iCloud signing", entitlements.get("com.apple.developer.icloud-container-environment") == "Production", "Production container entitlement")
except (OSError, ValueError, KeyError, plistlib.InvalidFileException) as error:
    check("Readable release artifact", False, str(error))

report = {"artifact": str(args.artifact.resolve()), "version": info.get("CFBundleShortVersionString") if "info" in locals() else None, "build": info.get("CFBundleVersion") if "info" in locals() else None, "passed": all(item["passed"] for item in checks), "distribution_checked": args.distribution, "checks": checks, "limits": ["This local check does not submit to Apple or certify App Review approval.", "Physical device, accessibility, crash, import/export handoff and two-device iCloud QA remain separate.", "Public support/privacy URLs and App Store Connect metadata are not verified here."]}
if args.report:
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
for item in checks:
    print(f"{'PASS' if item['passed'] else 'FAIL'} {item['name']}: {item['detail']}")
print("Local artifact checks passed." if report["passed"] else "Release artifact needs attention.")
sys.exit(0 if report["passed"] else 1)
