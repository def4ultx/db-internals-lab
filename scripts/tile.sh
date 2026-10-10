#!/bin/bash
# usage: scripts/tile.sh out.png a.png b.png c.png d.png  -> 2x2 contact sheet (1920x1080)
out=$1; shift; args=(); f=""; i=0
for x in "$@"; do args+=(-i "$x"); f+="[$i:v]scale=960:540[v$i];"; i=$((i+1)); done
inp=""; for ((j=0;j<i;j++)); do inp+="[v$j]"; done
ffmpeg -y -loglevel error "${args[@]}" -filter_complex "${f}${inp}xstack=inputs=$i:layout=0_0|960_0|0_540|960_540" -frames:v 1 "$out"
