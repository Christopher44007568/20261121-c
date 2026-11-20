#include "core/Calibration.h"

#include <fstream>
#include <iostream>
#include <string>

int main(int argc, char **argv) {
    const micro::Phantom phantom = micro::makeCalibrationPhantom();
    const micro::ValidationReport report = micro::runValidation(phantom);
    const std::string markdown = report.markdown();

    if (argc > 1) {
        std::ofstream file(argv[1], std::ios::binary);
        if (!file) {
            std::cerr << "Cannot write " << argv[1] << "\n";
            return 1;
        }
        file << markdown;
        std::cout << "Wrote calibration report to " << argv[1] << "\n";
    } else {
        std::cout << markdown;
    }
    return 0;
}

