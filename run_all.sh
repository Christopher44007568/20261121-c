#!/bin/sh
# Reproduce all results (CPU only, no GPU required).
set -e
cd "$(dirname "$0")"

g++ -O2 -fopenmp -std=c++17 -o out/pathtrace src/pathtrace.cpp

# 1. numerical acceptance: MC slab vs analytic parallel-plate solution
./out/pathtrace validate 1000000 | tee out/validate.log

# 2. angle sweep + plots
./out/pathtrace sweep 100000 out/sweep.csv
python3 tools/plot_sweep.py out/sweep.csv out/sweep
(cd tools && python3 color_strip.py ../out/sweep.csv ../out/transmitted_color.png)

# 3. renders: thin vs thick amber with droplets, three view elevations
./out/pathtrace render 640 360 1024 3  out/amber_elev03.ppm
./out/pathtrace render 480 270 512  25 out/amber_elev25.ppm
./out/pathtrace render 480 270 512  55 out/amber_elev55.ppm
for e in 03 25 55; do
    python3 tools/ppm2png.py out/amber_elev$e.ppm out/amber_elev$e.png
done
echo "all outputs in out/"
