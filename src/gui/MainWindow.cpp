#include "gui/MainWindow.h"

#include "core/ChunkReader.h"
#include "core/SceneGenerator.h"
#include "gui/PointCloudView.h"

#include <QAction>
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QDir>
#include <QDockWidget>
#include <QDoubleSpinBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QFontDatabase>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QKeySequence>
#include <QLabel>
#include <QMessageBox>
#include <QPushButton>
#include <QSignalBlocker>
#include <QSlider>
#include <QStandardPaths>
#include <QStatusBar>
#include <QTimer>
#include <QToolBar>
#include <QVBoxLayout>
#include <QWidget>

#include <algorithm>
#include <cmath>

namespace {

constexpr double kMegabyte = 1024.0 * 1024.0;

QString mib(std::uint64_t bytes) {
    return QString::number(static_cast<double>(bytes) / kMegabyte, 'f', 2);
}

std::uint64_t toBytes(double megabytes) {
    return static_cast<std::uint64_t>(std::max(0.0, megabytes) * kMegabyte);
}

}  // namespace

MainWindow::MainWindow(const QString& initialScene, QWidget* parent)
    : QMainWindow(parent) {
    setWindowTitle("Octree Point Cloud Streamer");
    resize(1440, 900);
    buildUi();

    if (!initialScene.isEmpty()) {
        QTimer::singleShot(0, this, [this, initialScene] { openScene(initialScene); });
    } else {
        QTimer::singleShot(0, this, [this] {
            const QString demo = defaultDemoPath();
            if (QFileInfo::exists(demo)) {
                openScene(demo);
            } else {
                generateDemoScene();
            }
        });
    }
}

MainWindow::~MainWindow() {
    if (view_) {
        view_->clearScene();
    }
    if (reader_) {
        reader_->close();
    }
}

void MainWindow::setStartupBudgets(std::optional<double> diskMegabytesPerSecond,
                                   std::optional<double> vramMegabytes,
                                   std::optional<double> ssePixels) {
    if (diskMegabytesPerSecond) {
        diskSpin_->setValue(*diskMegabytesPerSecond);
    }
    if (vramMegabytes) {
        vramSpin_->setValue(*vramMegabytes);
    }
    if (ssePixels) {
        sseSpin_->setValue(*ssePixels);
    }
}

void MainWindow::buildUi() {
    view_ = new PointCloudView(this);
    setCentralWidget(view_);
    buildToolbar();
    buildStreamingDock();
    buildTelemetryDock();

    connect(view_, &PointCloudView::pathPlayingChanged, this, [this](bool playing) {
        if (!playAction_) {
            return;
        }
        QSignalBlocker blocker(playAction_);
        playAction_->setChecked(playing);
    });
    connect(view_, &PointCloudView::loadingChanged, this, [this] {
        statusBar()->showMessage("Streaming octree chunks...", 1200);
    });

    telemetryTimer_ = new QTimer(this);
    telemetryTimer_->setInterval(250);
    connect(telemetryTimer_, &QTimer::timeout, this, &MainWindow::updateTelemetry);
    telemetryTimer_->start();
    statusBar()->showMessage("Left drag: orbit | Wheel: zoom | Space: path | T: color order");
}

void MainWindow::buildToolbar() {
    auto* toolbar = addToolBar(tr("Scene"));
    toolbar->setMovable(false);

    auto* openAction = toolbar->addAction(tr("Open..."));
    openAction->setShortcut(QKeySequence::Open);
    connect(openAction, &QAction::triggered, this, [this] {
        const QString path = QFileDialog::getOpenFileName(
            this, tr("Open point cloud"), QFileInfo(scenePath_).absolutePath(),
            tr("Point cloud octree (*.pcloud);;All files (*)"));
        if (!path.isEmpty()) {
            openScene(path);
        }
    });

    auto* demoAction = toolbar->addAction(tr("Generate demo"));
    connect(demoAction, &QAction::triggered, this, &MainWindow::generateDemoScene);
    toolbar->addSeparator();

    playAction_ = toolbar->addAction(tr("Play path"));
    playAction_->setCheckable(true);
    playAction_->setShortcut(Qt::Key_Space);
    playAction_->setEnabled(false);
    connect(playAction_, &QAction::toggled, this, [this](bool playing) {
        view_->setPathPlaying(playing);
    });

    auto* resetAction = toolbar->addAction(tr("Reset view"));
    resetAction->setShortcut(Qt::Key_R);
    connect(resetAction, &QAction::triggered, view_, &PointCloudView::resetCamera);
    toolbar->addSeparator();

    recordAction_ = toolbar->addAction(tr("Record"));
    recordAction_->setCheckable(true);
    recordAction_->setShortcut(QKeySequence(Qt::CTRL | Qt::Key_R));
    recordAction_->setEnabled(false);
    connect(recordAction_, &QAction::toggled, this, [this](bool enabled) {
        view_->setRecording(enabled);
        statusBar()->showMessage(
            enabled ? "Recording per-frame telemetry" : "Recording stopped", 2500);
    });

    saveAction_ = toolbar->addAction(tr("Save metrics..."));
    saveAction_->setShortcut(QKeySequence::Save);
    saveAction_->setEnabled(false);
    connect(saveAction_, &QAction::triggered, this, &MainWindow::saveMetrics);

    auto* orderAction = new QAction(tr("Toggle transparent order"), this);
    orderAction->setShortcut(Qt::Key_T);
    addAction(orderAction);
    connect(orderAction, &QAction::triggered, this, [this] {
        if (orderCombo_) {
            orderCombo_->setCurrentIndex((orderCombo_->currentIndex() + 1) %
                                         orderCombo_->count());
        }
    });

    auto* colorAction = new QAction(tr("Toggle node color"), this);
    colorAction->setShortcut(Qt::Key_C);
    addAction(colorAction);
    connect(colorAction, &QAction::triggered, this, [this] {
        if (colorByNodeCheck_) {
            colorByNodeCheck_->setChecked(!colorByNodeCheck_->isChecked());
        }
    });
}

void MainWindow::buildStreamingDock() {
    auto* dock = new QDockWidget(tr("Streaming budgets"), this);
    dock->setObjectName("streaming-dock");
    dock->setAllowedAreas(Qt::LeftDockWidgetArea | Qt::RightDockWidgetArea);
    auto* panel = new QWidget(dock);
    auto* layout = new QVBoxLayout(panel);
    auto* form = new QFormLayout();

    sseSpin_ = new QDoubleSpinBox(panel);
    sseSpin_->setRange(0.25, 256.0);
    sseSpin_->setDecimals(2);
    sseSpin_->setSingleStep(0.5);
    sseSpin_->setValue(view_->sseThreshold());
    sseSpin_->setSuffix(" px");
    form->addRow(tr("Screen error"), sseSpin_);
    connect(sseSpin_, &QDoubleSpinBox::valueChanged, view_, &PointCloudView::setSseThreshold);

    diskSpin_ = new QDoubleSpinBox(panel);
    diskSpin_->setRange(0.0, 4000.0);
    diskSpin_->setDecimals(1);
    diskSpin_->setSingleStep(1.0);
    diskSpin_->setValue(0.0);
    diskSpin_->setSuffix(" MiB/s");
    diskSpin_->setSpecialValueText(tr("Unlimited"));
    form->addRow(tr("Disk throttle"), diskSpin_);
    connect(diskSpin_, &QDoubleSpinBox::valueChanged, this, [this] {
        applyReaderSettings();
    });

    vramSpin_ = new QDoubleSpinBox(panel);
    vramSpin_->setRange(0.0, 8192.0);
    vramSpin_->setDecimals(0);
    vramSpin_->setSingleStep(8.0);
    vramSpin_->setValue(256.0);
    vramSpin_->setSuffix(" MiB");
    vramSpin_->setSpecialValueText(tr("Unlimited"));
    form->addRow(tr("GPU budget"), vramSpin_);
    connect(vramSpin_, &QDoubleSpinBox::valueChanged, this, [this] {
        view_->setVramLimit(vramLimitBytes());
    });

    alphaSlider_ = new QSlider(Qt::Horizontal, panel);
    alphaSlider_->setRange(2, 100);
    alphaSlider_->setValue(55);
    form->addRow(tr("Point alpha"), alphaSlider_);
    connect(alphaSlider_, &QSlider::valueChanged, this, [this](int value) {
        view_->setAlpha(static_cast<double>(value) / 100.0);
    });

    pointSizeSlider_ = new QSlider(Qt::Horizontal, panel);
    pointSizeSlider_->setRange(5, 80);
    pointSizeSlider_->setValue(25);
    form->addRow(tr("Point size x0.1"), pointSizeSlider_);
    connect(pointSizeSlider_, &QSlider::valueChanged, this, [this](int value) {
        view_->setPointSize(static_cast<double>(value) / 10.0);
    });

    orderCombo_ = new QComboBox(panel);
    orderCombo_->addItem(tr("Back-to-front (correct)"),
                         static_cast<int>(PointCloudView::RenderOrder::BackToFront));
    orderCombo_->addItem(tr("Front-to-back (debug)"),
                         static_cast<int>(PointCloudView::RenderOrder::FrontToBackDebug));
    form->addRow(tr("Transparent order"), orderCombo_);
    connect(orderCombo_, &QComboBox::currentIndexChanged, this, [this](int) {
        const auto order = static_cast<PointCloudView::RenderOrder>(
            orderCombo_->currentData().toInt());
        view_->setRenderOrder(order);
        if (modeLabel_) {
            modeLabel_->setText(
                order == PointCloudView::RenderOrder::BackToFront
                    ? tr("Blend order: far to near")
                    : tr("Blend order: near to far (order-debug)"));
        }
    });

    colorByNodeCheck_ = new QCheckBox(tr("Color by octree node"), panel);
    connect(colorByNodeCheck_, &QCheckBox::toggled, view_, &PointCloudView::setColorByNode);
    form->addRow(colorByNodeCheck_);
    layout->addLayout(form);

    auto* stressLayout = new QHBoxLayout();
    auto* stressButton = new QPushButton(tr("Disk/VRAM stress"), panel);
    connect(stressButton, &QPushButton::clicked, this, [this] {
        sseSpin_->setValue(2.0);
        diskSpin_->setValue(2.0);
        vramSpin_->setValue(16.0);
        statusBar()->showMessage(
            "Stress profile: 2 MiB/s disk, 16 MiB VRAM, 2 px SSE", 5000);
    });
    auto* defaultsButton = new QPushButton(tr("Defaults"), panel);
    connect(defaultsButton, &QPushButton::clicked, this, [this] {
        sseSpin_->setValue(6.0);
        diskSpin_->setValue(0.0);
        vramSpin_->setValue(256.0);
    });
    stressLayout->addWidget(stressButton);
    stressLayout->addWidget(defaultsButton);
    layout->addLayout(stressLayout);
    layout->addStretch(1);
    dock->setWidget(panel);
    addDockWidget(Qt::LeftDockWidgetArea, dock);
}

void MainWindow::buildTelemetryDock() {
    auto* dock = new QDockWidget(tr("Telemetry"), this);
    dock->setObjectName("telemetry-dock");
    dock->setAllowedAreas(Qt::LeftDockWidgetArea | Qt::RightDockWidgetArea);
    auto* panel = new QWidget(dock);
    auto* layout = new QVBoxLayout(panel);
    sceneLabel_ = new QLabel(tr("No scene loaded"), panel);
    sceneLabel_->setWordWrap(true);
    sceneLabel_->setTextInteractionFlags(Qt::TextSelectableByMouse);
    modeLabel_ = new QLabel(tr("Blend order: far to near"), panel);
    telemetryLabel_ = new QLabel(panel);
    telemetryLabel_->setWordWrap(true);
    telemetryLabel_->setTextInteractionFlags(Qt::TextSelectableByMouse);
    telemetryLabel_->setFont(QFontDatabase::systemFont(QFontDatabase::FixedFont));
    layout->addWidget(sceneLabel_);
    layout->addWidget(modeLabel_);
    layout->addSpacing(8);
    layout->addWidget(telemetryLabel_);
    layout->addStretch(1);
    dock->setWidget(panel);
    dock->setMinimumWidth(330);
    addDockWidget(Qt::RightDockWidgetArea, dock);
}

void MainWindow::openScene(const QString& path) {
    const QFileInfo info(path);
    if (!info.exists()) {
        QMessageBox::critical(
            this, tr("Open scene"), tr("Scene file does not exist:\n%1").arg(path));
        return;
    }

    std::string error;
    auto scene = pcloud::SceneIndex::open(path.toStdString(), &error);
    if (!scene) {
        QMessageBox::critical(
            this, tr("Open scene"),
            tr("Cannot open %1\n\n%2").arg(path, QString::fromStdString(error)));
        return;
    }

    if (view_) {
        view_->clearScene();
    }
    if (reader_) {
        reader_->close();
        reader_.reset();
    }
    scene_ = std::move(scene);
    scenePath_ = info.absoluteFilePath();
    ++sceneEpoch_;
    reader_ = std::make_unique<pcloud::ChunkReader>(
        scene_, diskLimitBytes(), 2);

    view_->setVramLimit(vramLimitBytes());
    view_->setSseThreshold(sseSpin_->value());
    view_->setAlpha(static_cast<double>(alphaSlider_->value()) / 100.0);
    view_->setPointSize(static_cast<double>(pointSizeSlider_->value()) / 10.0);
    view_->setRenderOrder(static_cast<PointCloudView::RenderOrder>(
        orderCombo_->currentData().toInt()));
    view_->setColorByNode(colorByNodeCheck_->isChecked());
    view_->setScene(scene_, reader_.get(), sceneEpoch_);
    view_->setRecording(true);

    {
        QSignalBlocker blocker(playAction_);
        playAction_->setChecked(false);
    }
    playAction_->setEnabled(true);
    {
        QSignalBlocker blocker(recordAction_);
        recordAction_->setChecked(true);
    }
    recordAction_->setEnabled(true);
    saveAction_->setEnabled(true);
    updateSceneSummary();
    updateTelemetry();
    setWindowTitle(QStringLiteral("%1 - Octree Point Cloud Streamer")
                       .arg(info.fileName()));
    statusBar()->showMessage(
        tr("Loaded %1 nodes from %2").arg(scene_->nodeCount()).arg(scenePath_), 5000);
}

QString MainWindow::defaultDemoPath() const {
    const QString directory =
        QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    return QDir(directory).filePath("demo_scene.pcloud");
}

void MainWindow::generateDemoScene() {
    const QString output = defaultDemoPath();
    QDir().mkpath(QFileInfo(output).absolutePath());
    pcloud::SceneGenerationConfig config;
    config.pointCount = 220'000;
    config.maxDepth = 6;
    config.nodePointLimit = 3072;
    config.seed = 7;
    config.halfExtent = 16.0;

    QApplication::setOverrideCursor(Qt::WaitCursor);
    statusBar()->showMessage(tr("Generating %1-point demo scene...").arg(config.pointCount));
    QApplication::processEvents();
    pcloud::SceneGenerationResult result;
    std::string error;
    const bool ok = pcloud::SceneGenerator::generate(config, output.toStdString(), &result, &error);
    QApplication::restoreOverrideCursor();
    if (!ok) {
        QMessageBox::critical(
            this, tr("Generate demo"),
            tr("Scene generation failed:\n%1").arg(QString::fromStdString(error)));
        return;
    }
    statusBar()->showMessage(
        tr("Generated %1 nodes (%2 MiB)")
            .arg(result.nodeCount)
            .arg(QString::number(static_cast<double>(result.fileBytes) / kMegabyte, 'f', 1)),
        4000);
    openScene(output);
}

void MainWindow::applyReaderSettings() {
    if (reader_) {
        reader_->setDiskBytesPerSecond(diskLimitBytes());
    }
}

std::uint64_t MainWindow::diskLimitBytes() const {
    return toBytes(diskSpin_ ? diskSpin_->value() : 0.0);
}

std::uint64_t MainWindow::vramLimitBytes() const {
    return toBytes(vramSpin_ ? vramSpin_->value() : 0.0);
}

void MainWindow::updateSceneSummary() {
    if (!scene_) {
        sceneLabel_->setText(tr("No scene loaded"));
        return;
    }
    int maxDepth = 0;
    for (const pcloud::DiskNode& node : scene_->nodes()) {
        maxDepth = std::max(maxDepth, static_cast<int>(node.depth));
    }
    sceneLabel_->setText(
        tr("<b>%1</b><br/>%2 nodes, %3 MiB<br/>root error %4, depth %5")
            .arg(QFileInfo(scenePath_).fileName())
            .arg(scene_->nodeCount())
            .arg(QString::number(
                     static_cast<double>(scene_->header().fileSize) / kMegabyte, 'f', 2))
            .arg(scene_->header().maxGeometricError, 0, 'f', 2)
            .arg(maxDepth));
}

void MainWindow::updateTelemetry() {
    if (!view_ || !telemetryLabel_) {
        return;
    }
    const pcloud::MetricsSnapshot metrics = view_->cachedMetrics();
    const QString text =
        tr("frames       %1\n"
           "visible      %2  fallback %3\n"
           "frontier     %4\n"
           "GPU bytes    %5 / %6 MiB\n"
           "GPU peak     %7 MiB\n"
           "resident     CPU %8  GPU %9\n"
           "missing      last %10  total %11\n"
           "missing frm  %12\n"
           "duplicates   last %13  total %14\n"
           "dup frames   %15\n"
           "evictions    %16  blocked %17\n"
           "disk read    %18 MiB  queue %19\n"
           "throttle     %20 ms  completed %21")
            .arg(metrics.frames)
            .arg(metrics.lastVisible)
            .arg(metrics.lastFallback)
            .arg(metrics.lastRequiredFrontier)
            .arg(mib(metrics.gpuBytes))
            .arg(metrics.gpuLimitBytes == 0 ? tr("inf") : mib(metrics.gpuLimitBytes))
            .arg(mib(metrics.gpuPeakBytes))
            .arg(metrics.cpuResident)
            .arg(metrics.gpuResident)
            .arg(metrics.lastMissing)
            .arg(metrics.missingNodeFrames)
            .arg(metrics.framesWithMissing)
            .arg(metrics.lastDuplicates)
            .arg(metrics.duplicateNodeFrames)
            .arg(metrics.framesWithDuplicates)
            .arg(metrics.evictions)
            .arg(metrics.blockedEvictions)
            .arg(mib(metrics.io.bytesRead))
            .arg(metrics.io.queued + metrics.io.inFlight)
            .arg(metrics.io.totalThrottleWaitMs)
            .arg(metrics.io.completed);
    telemetryLabel_->setText(text);
}

void MainWindow::saveMetrics() {
    const QString path = QFileDialog::getSaveFileName(
        this, tr("Save frame telemetry"),
        QDir::home().filePath("pcloud_metrics.csv"),
        tr("CSV files (*.csv);;All files (*)"));
    if (path.isEmpty() || !view_) {
        return;
    }
    QString error;
    if (!view_->saveRecording(path, &error)) {
        QMessageBox::critical(
            this, tr("Save metrics"), tr("Cannot write CSV:\n%1").arg(error));
        return;
    }
    statusBar()->showMessage(tr("Metrics saved to %1").arg(path), 5000);
}
