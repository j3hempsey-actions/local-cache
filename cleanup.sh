#!/bin/bash
# Directory to monitor for clean up
CACHE_DIR=${CACHE_DIR:-/media/cache}
# Percentage of filesystem full for when to act on $dir
act=80
# Maximum number of files to delete at a time - a safe guard for bailing out
maxfiles=10
for _ in $(seq 0 $maxfiles); do
    output=$(df -k "$CACHE_DIR" | awk '! /^Filesystem/ { print $5 " " $1 }')
    usep=$(echo "$output" | awk '{ print $1}' | cut -d'%' -f1  )
    partition=$(echo "$output" | awk '{ print $2 }' )
    if (( usep >= act )); then
        echo "Running out of space \"$partition ($usep%)\" on $(hostname) as on $(date)"
        oldfile=$(find "$CACHE_DIR" -type f  -printf "%T@ %Tc %p\n" | sort -n | head -n 1 | awk '{ print $9 }')
        echo "Deleting \"$oldfile\" ..."
        rm -f "$oldfile"
    else
        echo "Plenty of free space. Exiting..."
        exit
        break
    fi
done
echo "Reached $maxfiles removal limit. Exiting..."
