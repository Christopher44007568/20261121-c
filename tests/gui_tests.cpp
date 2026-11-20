#include "io/VolumeIO.h"
#include "ui/MainWindow.h"
#include "ui/SliceView.h"

#include <QDoubleSpinBox>
#include <QImage>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QtTest>

#include <cmath>

class GuiTests : public QObject {
    Q_OBJECT

private slots:
    void dragCreatesPhysicalMeasurement();
    void obliquePlaneUsesSamePhysicalMapping();
    void changingSpacingRemapsMeasurements();
    void imageStackLoadPreservesAnisotropicSpacing();
};

namespace {

double tableValue(QTableWidget *table, int row, int column) {
    return table->item(row, column)->text().toDouble();
}

void clearMeasurements(microqt::MainWindow &window) {
    QMetaObject::invokeMethod(&window, "clearMeasurements",
                              Qt::DirectConnection);
    QCoreApplication::processEvents();
}

} // namespace

void GuiTests::dragCreatesPhysicalMeasurement() {
    microqt::MainWindow window;
    window.resize(1360, 860);
    window.show();
    QTest::qWait(350);
    auto *slice = window.findChild<microqt::SliceView *>();
    auto *table = window.findChild<QTableWidget *>();
    QVERIFY(slice);
    QVERIFY(table);

    clearMeasurements(window);
    const QPoint start = slice->rect().center() + QPoint(-90, 25);
    const QPoint end = slice->rect().center() + QPoint(85, 25);
    QTest::mousePress(slice, Qt::LeftButton, Qt::NoModifier, start);
    QTest::mouseMove(slice, end, 20);
    QTest::mouseRelease(slice, Qt::LeftButton, Qt::NoModifier, end);
    QCoreApplication::processEvents();

    QCOMPARE(table->rowCount(), 1);
    const double length = tableValue(table, 0, 0);
    const double dx = tableValue(table, 0, 1);
    const double dy = tableValue(table, 0, 2);
    const double dz = tableValue(table, 0, 3);
    QVERIFY(length > 10.0);
    QVERIFY(std::abs(length - std::hypot(dx, dy, dz)) < 0.02);
    QVERIFY(std::abs(dz) < 1e-6);
}

void GuiTests::obliquePlaneUsesSamePhysicalMapping() {
    microqt::MainWindow window;
    window.resize(1360, 860);
    window.show();
    QTest::qWait(350);
    auto *slice = window.findChild<microqt::SliceView *>();
    auto *table = window.findChild<QTableWidget *>();
    QVERIFY(slice);
    QVERIFY(table);

    QList<QDoubleSpinBox *> angleSpins;
    for (QDoubleSpinBox *spin : window.findChildren<QDoubleSpinBox *>()) {
        if (spin->suffix().trimmed() == QStringLiteral("°")) {
            angleSpins.append(spin);
        }
    }
    QCOMPARE(angleSpins.size(), 2);
    angleSpins[0]->setValue(30.0);
    angleSpins[1]->setValue(20.0);
    QCoreApplication::processEvents();
    QCOMPARE(slice->tiltXDeg(), 30.0);
    QCOMPARE(slice->tiltYDeg(), 20.0);

    clearMeasurements(window);
    const QPoint start = slice->rect().center() + QPoint(-40, -30);
    const QPoint end = slice->rect().center() + QPoint(95, 50);
    QTest::mousePress(slice, Qt::LeftButton, Qt::NoModifier, start);
    QTest::mouseMove(slice, end, 20);
    QTest::mouseRelease(slice, Qt::LeftButton, Qt::NoModifier, end);
    QCoreApplication::processEvents();

    QCOMPARE(table->rowCount(), 1);
    const double length = tableValue(table, 0, 0);
    const double dx = tableValue(table, 0, 1);
    const double dy = tableValue(table, 0, 2);
    const double dz = tableValue(table, 0, 3);
    QVERIFY(length > 10.0);
    QVERIFY(std::abs(length - std::hypot(dx, dy, dz)) < 0.02);
    QVERIFY(std::abs(dz) > 1.0);

    const QString screenshot = qEnvironmentVariable("MICROSLICE_TEST_SCREENSHOT");
    if (!screenshot.isEmpty()) {
        window.grab().save(screenshot);
    }
}

void GuiTests::changingSpacingRemapsMeasurements() {
    microqt::MainWindow window;
    window.resize(1360, 860);
    window.show();
    QTest::qWait(350);
    auto *slice = window.findChild<microqt::SliceView *>();
    auto *table = window.findChild<QTableWidget *>();
    QVERIFY(slice);
    QVERIFY(table);

    clearMeasurements(window);
    const QPoint start = slice->rect().center() + QPoint(-70, 20);
    const QPoint end = slice->rect().center() + QPoint(70, 20);
    QTest::mousePress(slice, Qt::LeftButton, Qt::NoModifier, start);
    QTest::mouseMove(slice, end, 20);
    QTest::mouseRelease(slice, Qt::LeftButton, Qt::NoModifier, end);
    QCoreApplication::processEvents();
    QCOMPARE(table->rowCount(), 1);
    const double originalLength = tableValue(table, 0, 0);

    QDoubleSpinBox *xSpacing = nullptr;
    for (QDoubleSpinBox *spin : window.findChildren<QDoubleSpinBox *>()) {
        if (spin->suffix().trimmed() == QStringLiteral("µm") &&
            std::abs(spin->value() - 5.0) < 1e-6) {
            xSpacing = spin;
            break;
        }
    }
    QVERIFY(xSpacing);
    xSpacing->setValue(10.0);
    QCoreApplication::processEvents();

    const double changedLength = tableValue(table, 0, 0);
    QVERIFY(std::abs(changedLength - originalLength * 2.0) < 0.05);
}

void GuiTests::imageStackLoadPreservesAnisotropicSpacing() {
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const QStringList names = {QStringLiteral("slice10.png"),
                               QStringLiteral("slice2.png"),
                               QStringLiteral("slice1.png")};
    const int grayValues[3] = {30, 20, 10};
    QStringList paths;
    for (int index = 0; index < 3; ++index) {
        QImage image(4, 3, QImage::Format_Grayscale8);
        image.fill(grayValues[index]);
        const QString path = directory.filePath(names[index]);
        QVERIFY(image.save(path));
        paths.append(path);
    }
    microqt::LoadedStack loaded;
    QString error;
    QVERIFY2(microqt::loadImageStack(paths, {2.0, 3.5, 6.0}, &loaded, &error),
             qPrintable(error));
    QCOMPARE(loaded.volume.geometry().nx, 4);
    QCOMPARE(loaded.volume.geometry().ny, 3);
    QCOMPARE(loaded.volume.geometry().nz, 3);
    QCOMPARE(loaded.volume.geometry().spacingUm.x, 2.0);
    QCOMPARE(loaded.volume.geometry().spacingUm.y, 3.5);
    QCOMPARE(loaded.volume.geometry().spacingUm.z, 6.0);
    QCOMPARE(loaded.files.size(), 3);
    QVERIFY(loaded.files[0].endsWith(QStringLiteral("slice1.png")));
    QVERIFY(loaded.files[1].endsWith(QStringLiteral("slice2.png")));
    QVERIFY(loaded.files[2].endsWith(QStringLiteral("slice10.png")));
    QVERIFY(std::abs(loaded.volume.at(0, 0, 0) - 10.0 / 255.0) < 1e-6);
    QVERIFY(std::abs(loaded.volume.at(0, 0, 2) - 30.0 / 255.0) < 1e-6);
}

QTEST_MAIN(GuiTests)
#include "gui_tests.moc"

