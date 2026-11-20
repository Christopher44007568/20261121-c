#include "ui/MainWindow.h"

#include <QApplication>
#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QTimer>

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    QApplication::setApplicationName(QStringLiteral("MicroSlice3D"));
    QApplication::setApplicationVersion(QStringLiteral(MICROSLICE_VERSION));
    QApplication::setOrganizationName(QStringLiteral("MicroSlice"));
    QApplication::setStyle(QStringLiteral("Fusion"));

    QCommandLineParser parser;
    parser.setApplicationDescription(
        QStringLiteral("Anisotropic microscopy volume slicing and physical measurement"));
    parser.addHelpOption();
    parser.addVersionOption();
    QCommandLineOption screenshotOption(
        QStringList{QStringLiteral("s"), QStringLiteral("screenshot")},
        QStringLiteral("Save a window screenshot and exit."),
        QStringLiteral("path"));
    QCommandLineOption overviewOption(
        QStringList{QStringLiteral("o"), QStringLiteral("overview")},
        QStringLiteral("Open the 3D overview tab."));
    parser.addOption(screenshotOption);
    parser.addOption(overviewOption);
    parser.process(app);

    microqt::MainWindow window;
    window.show();
    if (parser.isSet(overviewOption)) {
        window.showOverview();
    }

    if (parser.isSet(screenshotOption)) {
        const QString path = parser.value(screenshotOption);
        QTimer::singleShot(900, &window, [&window, path] {
            const bool saved = window.grab().save(path);
            QApplication::exit(saved ? 0 : 2);
        });
    }

    return app.exec();
}

