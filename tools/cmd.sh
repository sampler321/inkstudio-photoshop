#!/bin/zsh
# send one dev command to the running panel and print its answer: tools/cmd.sh '{"op":"select","pack":"..."}'
D="$HOME/Library/Application Support/Adobe/UXP/PluginsStorage/PHSP/27/External/inkstudio.photoshop/PluginData"
rm -f "$D/cmd.out"; printf '%s' "$1" > "$D/cmd.json"
for i in {1..40}; do [ -f "$D/cmd.out" ] && { cat "$D/cmd.out"; exit 0; }; sleep 0.5; done; echo timeout
