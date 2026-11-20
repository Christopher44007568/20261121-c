#pragma once

#include "ui/Measurement.h"

#include <QMainWindow>
#include <QVector>

#include <memory>

class QAction;
class QCheckBox;
class QComboBox;
class QDoubleSpinBox;
class QLabel;
class QTableWidget;
class QTabWidget;

namespace micro {
class Volume;
}

namespace microqt {

class SliceView;
class OverviewView;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

    void showOverview();

private slots:
    void openImageStack();
    void loadCalibrationPhantom();
    void setFrontView();
    void fitCurrentView();
    void showCalibrationReport();
    void exportCurrentView();
    void applySpacingControls();
    void applyPlaneControls();
    void updateInterpolation();
    void onPlaneCenterChanged(const micro::Vec3 &centerUm);
    void addMeasurement(const micro::Vec3 &aUm, const micro::Vec3 &bUm);
    void deleteSelectedMeasurements();
    void clearMeasurements();
    void updateMeasurementsTable();
    void onZoomChanged(double zoom);
    void onViewInfoChanged(const QString &text);
    void onOverviewInfoChanged(const QString &text);

private:
    void buildUi();
    void buildActions();
    void applyStyle();
    void installVolume(std::unique_ptr<micro::Volume> volume,
                       const QString &sourceText,
                       const QString &calibrationHint);
    void updateVolumeInfo();
    void syncPlaneControls(const micro::Vec3 &centerUm, double tiltXDeg,
                           double tiltYDeg);
    void syncSpacingControls();
    void setMeasurements(const QVector<Measurement> &measurements);
    QString measurementMetadata() const;

    std::unique_ptr<micro::Volume> m_volume;
    QVector<Measurement> m_measurements;
    QString m_sourceText;
    QString m_calibrationHint;
    bool m_syncingControls = false;

    SliceView *m_sliceView = nullptr;
    OverviewView *m_overviewView = nullptr;
    QTabWidget *m_tabs = nullptr;
    QTableWidget *m_measurementTable = nullptr;
    QLabel *m_sourceLabel = nullptr;
    QLabel *m_volumeInfoLabel = nullptr;
    QLabel *m_zoomLabel = nullptr;
    QLabel *m_calibrationLabel = nullptr;
    QCheckBox *m_measurementMode = nullptr;
    QComboBox *m_interpolationCombo = nullptr;
    QDoubleSpinBox *m_spacingSpins[3] = {nullptr, nullptr, nullptr};
    QDoubleSpinBox *m_centerSpins[3] = {nullptr, nullptr, nullptr};
    QDoubleSpinBox *m_tiltSpins[2] = {nullptr, nullptr};

    QAction *m_openAction = nullptr;
    QAction *m_demoAction = nullptr;
    QAction *m_frontAction = nullptr;
    QAction *m_fitAction = nullptr;
    QAction *m_reportAction = nullptr;
    QAction *m_exportAction = nullptr;
    QAction *m_clearAction = nullptr;
    QAction *m_overviewAction = nullptr;
};

} // namespace microqt

