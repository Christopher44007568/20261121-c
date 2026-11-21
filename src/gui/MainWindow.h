#pragma once

#include "core/SceneIndex.h"

#include <QMainWindow>

#include <cstdint>
#include <memory>
#include <optional>

namespace pcloud {
class ChunkReader;
}

class QAction;
class QCheckBox;
class QComboBox;
class QDoubleSpinBox;
class QLabel;
class QPushButton;
class QSlider;
class QTimer;
class PointCloudView;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(const QString& initialScene = {}, QWidget* parent = nullptr);
    ~MainWindow() override;
    void setStartupBudgets(std::optional<double> diskMegabytesPerSecond,
                           std::optional<double> vramMegabytes,
                           std::optional<double> ssePixels);

private:
    void buildUi();
    void buildToolbar();
    void buildStreamingDock();
    void buildTelemetryDock();
    void openScene(const QString& path);
    void generateDemoScene();
    void applyReaderSettings();
    void updateTelemetry();
    void saveMetrics();
    void updateSceneSummary();
    QString defaultDemoPath() const;
    std::uint64_t diskLimitBytes() const;
    std::uint64_t vramLimitBytes() const;

    PointCloudView* view_ = nullptr;
    QLabel* telemetryLabel_ = nullptr;
    QLabel* sceneLabel_ = nullptr;
    QLabel* modeLabel_ = nullptr;
    QDoubleSpinBox* sseSpin_ = nullptr;
    QDoubleSpinBox* diskSpin_ = nullptr;
    QDoubleSpinBox* vramSpin_ = nullptr;
    QSlider* alphaSlider_ = nullptr;
    QSlider* pointSizeSlider_ = nullptr;
    QComboBox* orderCombo_ = nullptr;
    QCheckBox* colorByNodeCheck_ = nullptr;
    QAction* playAction_ = nullptr;
    QAction* recordAction_ = nullptr;
    QAction* saveAction_ = nullptr;
    QTimer* telemetryTimer_ = nullptr;

    std::shared_ptr<pcloud::SceneIndex> scene_;
    std::unique_ptr<pcloud::ChunkReader> reader_;
    std::uint64_t sceneEpoch_ = 0;
    QString scenePath_;
};
