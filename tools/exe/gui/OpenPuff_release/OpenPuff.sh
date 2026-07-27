#!/bin/bash

check=$(dpkg-query -W wine 2> /dev/null);

if [[ "$check" = "wine"* ]]
then
 echo "** Starting Wine + OpenPuff. **"
 echo "** If this is the first time you run OpenPuff, it may take some time to initialize. **"
 wine ./OpenPuff.exe
else
 while true; do
  read -p "Wine is required to run OpenPuff. Install now? [y/n] " yn
  case $yn in
   [Yy]* ) sudo apt install wine-stable; echo "Now run ./Openpuff.sh"; break;;
   [Nn]* ) exit;;
   * ) echo "Please answer [y]es or [n]o.";;
 esac
done
fi;
