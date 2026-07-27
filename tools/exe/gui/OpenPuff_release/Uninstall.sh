#!/bin/bash

rm -r ~/.wine 
sudo apt autoremove wine-stable
cd ..
rm -r ./OpenPuff_release
echo "** Wine + OpenPuff have been fully removed from your system. **"
