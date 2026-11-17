#!/bin/zsh
# Rebuild the .ccx, install it, restart Photoshop (saving open documents first), print the plugin log.
set -e
cd "${0:A:h}/.."
v=$(python3 -c "import json;m=json.load(open('plugin/manifest.json'));a=m['version'].split('.');a[2]=str(int(a[2])+1);m['version']='.'.join(a);json.dump(m,open('plugin/manifest.json','w'),indent=2);print(m['version'])")
mkdir -p dist && rm -f dist/inkstudio.ccx && (cd plugin && zip -qr ../dist/inkstudio.ccx . -x '.*')
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install "$PWD/dist/inkstudio.ccx" | tail -1
if pgrep -f "Adobe Photoshop 2026.app/Contents/MacOS" >/dev/null; then
  osascript -e 'tell application id "com.adobe.Photoshop" to do javascript "var r=[];for(var i=0;i<app.documents.length;i++){var d=app.documents[i]; if(!d.saved){try{d.save()}catch(e){d.saveAs(new File(\"~/Desktop/\"+d.name.replace(/\\.[^.]*$/,\"\")+\".psd\"),new PhotoshopSaveOptions(),false)}}; r.push(d.fullName.fsName)}; r.join(\"\\n\")"' > /tmp/inkstudio-docs.txt 2>/dev/null || true
  osascript -e 'tell application id "com.adobe.Photoshop" to quit'
  while pgrep -f "Adobe Photoshop 2026.app/Contents/MacOS" >/dev/null; do sleep 1; done
fi
open -g -a "Adobe Photoshop 2026"
until osascript -e 'tell application id "com.adobe.Photoshop" to do javascript "app.version"' >/dev/null 2>&1; do sleep 3; done
while read -r f; do [ -n "$f" ] && osascript -e "tell application id \"com.adobe.Photoshop\" to do javascript \"app.open(new File('$f')); 1\"" >/dev/null; done < /tmp/inkstudio-docs.txt
osascript -e 'tell application id "com.adobe.Photoshop" to activate'
sleep 3
echo "v$v"; cat "$HOME/Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/External/inkstudio.photoshop/PluginData/inkstudio.log"
